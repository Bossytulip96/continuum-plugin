'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const host = require('./host');

function normalize(value) {
  let p = String(value || '');
  if (/^~([/\\]|$)/.test(p)) p = os.homedir() + p.slice(1);
  // Git Bash, MSYS, Cygwin and WSL spell C:\ as /c/, /cygdrive/c/ or /mnt/c/.
  // Claude Code's Bash tool on Windows uses the /c/ form, so the gate must read it.
  if (process.platform === 'win32') {
    const drive = p.match(/^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?=\/|$)/);
    if (drive) p = drive[1].toUpperCase() + ':' + p.slice(drive[0].length);
  }
  return p.replace(/[/\\]/g, path.sep);
}
// Codex keeps its own config folder, so approvals, logs and session state never mix
// with the Claude Code install. CONTINUUM_CONFIG still wins on either host.
function configPath() {
  const home = process.env.USERPROFILE || os.homedir();
  return path.resolve(normalize(process.env.CONTINUUM_CONFIG || (host.name() === 'claude'
    ? path.join(home, '.continuum', 'config.json')
    : path.join(home, '.continuum', host.name(), 'config.json'))));
}
function lexical(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function physical(p) {
  try {
    fs.lstatSync(p);
    return fs.realpathSync(p);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    try { fs.lstatSync(p); throw new Error('Unresolved symbolic link'); }
    catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
  }
  const parent = path.dirname(p);
  return parent === p ? p : path.join(physical(parent), path.basename(p));
}
function inside(base, target) {
  return lexical(base, target) && lexical(physical(path.resolve(base)), physical(path.resolve(target)));
}
// For classifying a target the model named: it counts as inside the base when
// either its spelling or its real location (through a junction or symlink) is.
// Internal path construction keeps the strict inside() above.
function covers(base, target) {
  try {
    if (lexical(base, target)) return true;
    return lexical(physical(path.resolve(base)), physical(path.resolve(target)));
  } catch (_) { return lexical(base, target); }
}
function contained(base, parts) {
  const p = path.resolve(base, ...parts.map(normalize));
  if (!inside(base, p)) throw new Error('Path escapes its configured folder');
  return p;
}
const pluginPath = (...parts) => contained(path.resolve(__dirname, '..', '..'), parts);
const configFile = (c, ...parts) => contained(c.configDir, parts);
const vaultPath = (c, ...parts) => contained(c.vault, parts);
// A value shown inside injected text stays on one line: a line break inside it cannot start a new line of text.
const oneLine = value => String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
function resolveTarget(c, value, cwd) {
  return path.resolve(normalize(cwd || c.vault), normalize(value));
}
function validate(input, file = configPath()) {
  if (!input || input.version !== 1) throw new Error('Config version must be 1');
  const c = { ...input, configPath: file, configDir: path.dirname(file) };
  if (typeof c.person !== 'string' || !c.person.trim()) throw new Error('A person is required');
  if (typeof c.vault !== 'string' || !path.isAbsolute(normalize(c.vault))) {
    throw new Error('Vault must be an absolute folder path');
  }
  c.vault = path.resolve(normalize(c.vault));
  if (typeof c.machine !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(c.machine)) {
    throw new Error('Machine must be a filename-safe label of 1 to 64 characters');
  }
  if (typeof c.timezone !== 'string' || !c.timezone) throw new Error('A timezone is required');
  new Intl.DateTimeFormat('en', { timeZone: c.timezone }).format();
  if (!['ask', 'trusted'].includes(c.autonomy)) throw new Error('Autonomy must be ask or trusted');
  c.gates = { 'vendor-write': true, 'email-send': true, 'vault-delete': true,
    'system-change': true, money: 'never', ...(c.gates || {}) };
  for (const level of ['vendor-write', 'email-send', 'vault-delete', 'system-change']) {
    if (c.gates[level] !== true) throw new Error('All action gates must remain enabled');
  }
  if (c.gates.money !== 'never') throw new Error('Money must remain never approvable');
  c.inject = { startPage: 'START HERE.md', maxNoteChars: 25000, maxNotesPerPrompt: 3,
    ...(c.inject || {}) };
  for (const name of ['maxNoteChars', 'maxNotesPerPrompt']) {
    if (!Number.isSafeInteger(c.inject[name]) || c.inject[name] < 1) {
      throw new Error('Injection limits must be positive integers');
    }
  }
  // inject.digests is optional; absent means "summary", so older configs load and save unchanged.
  if (c.inject.digests !== undefined && !['summary', 'full'].includes(c.inject.digests)) {
    throw new Error('inject.digests must be summary or full');
  }
  if (typeof c.inject.startPage !== 'string' || !c.inject.startPage) {
    throw new Error('A start page is required');
  }
  vaultPath(c, c.inject.startPage);
  if (c.digests === undefined) c.digests = true;
  if (typeof c.digests !== 'boolean') throw new Error('Digests must be true or false');
  return c;
}
function load() {
  const file = configPath();
  return validate(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')), file);
}
function stamp(c, value = new Date()) {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: c.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(d);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
}
const date = (c, value) => stamp(c, value).slice(0, 10);
const ttl = c => (c.autonomy === 'trusted' ? 24 : 1) * 3600000;
function sessionFile(c, sid) {
  const name = crypto.createHash('sha256').update(String(sid)).digest('hex') + '.json';
  return configFile(c, 'sessions', name);
}
function transcriptPath(c, value) {
  if (typeof value !== 'string' || !path.isAbsolute(normalize(value))) {
    throw new Error('An explicit absolute transcript path is required');
  }
  return path.resolve(normalize(value));
}
function logError(error) {
  try {
    const dir = path.dirname(configPath());
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(contained(dir, ['hooks.log']),
      new Date().toISOString() + ' | ' + String(error.message || error).replace(/[\r\n]/g, ' ') + '\n', 'utf8');
  } catch (_) { /* Logging cannot interrupt a session. */ }
}
// Informational hooks fail open (an error only costs context). A hook that passes
// an onError function fails closed: the error becomes that function's output.
// Missing config means the plugin is not set up yet, so every hook stays silent.
// Debug switch for live tests: CONTINUUM_DEBUG=1, or "debug": true in the config, appends the
// raw stdin of every hook to hook-inputs.log in the config folder. Off by default; never fails a hook.
function debugLog(event, raw, c) {
  try {
    if (process.env.CONTINUUM_DEBUG !== '1' && !(c && c.debug === true)) return;
    let name = event;
    let background;
    try {
      const parsed = JSON.parse(raw);
      name = parsed.hook_event_name || event;
      if (host.isCodex()) background = require('./codex').isBackground(parsed);
    } catch (_) { /* raw stays raw */ }
    const dir = path.dirname(configPath());
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(contained(dir, ['hook-inputs.log']), JSON.stringify({ ts: new Date().toISOString(),
      event: name, host: host.name(), background, stdin: raw }) + '\n', 'utf8');
  } catch (_) { /* Debug logging cannot interrupt a session. */ }
}
async function hook(event, handler, onError) {
  let output = {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    let c;
    try { c = load(); } catch (e) {
      debugLog(event, raw, null);
      if (e.code === 'ENOENT' && !fs.existsSync(configPath())) {
        process.stderr.write('[continuum] Run /continuum:continuum-setup to create the vault.\n');
        process.stdout.write('{}\n');
        process.exitCode = 0;
        return;
      }
      throw e;
    }
    debugLog(event, raw, c);
    const input = JSON.parse(raw || '{}');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Hook input must be an object');
    // Codex background sessions get nothing and change nothing, except from the gate,
    // which stays fully active for them.
    if (host.isCodex() && event !== 'PreToolUse' && require('./codex').isBackground(input)) output = {};
    else output = await handler(input, c) || {};
  } catch (e) {
    logError(e);
    if (onError) { try { output = onError(e) || {}; } catch (_) { output = {}; } }
  }
  try { process.stdout.write(JSON.stringify(output) + '\n'); } catch (_) { /* Closed pipe. */ }
  process.exitCode = 0;
}
function runCli(handler) {
  Promise.resolve().then(handler).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { configPath, normalize, inside, covers, pluginPath, configFile, vaultPath, oneLine,
  resolveTarget, validate, load, host, stamp, date, ttl, sessionFile, transcriptPath, logError, hook, runCli };
