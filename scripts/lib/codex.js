'use strict';
// Helpers used only when the host is Codex (see host.js). Claude Code never reaches this file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

// apply_patch sends the whole patch as tool_input.command. Each file operation starts with
// one of these header lines; "*** Move to:" follows an Update and names the new location.
function patchOps(text) {
  const ops = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\*\*\* (Add|Update|Delete) File:\s*(.+?)\s*$/);
    if (m) { current = { op: m[1].toLowerCase(), path: m[2], lines: [] }; ops.push(current); continue; }
    const move = line.match(/^\*\*\* Move to:\s*(.+?)\s*$/);
    if (move && current) { current.moveTo = move[1]; continue; }
    if (/^\*\*\* (?:Begin|End) Patch/.test(line)) { current = null; continue; }
    if (current) current.lines.push(line);
  }
  // The text a new file will hold: the "+" lines of an Add.
  for (const op of ops) {
    op.content = op.op === 'add' ? op.lines.filter(l => l.startsWith('+')).map(l => l.slice(1)).join('\n') : '';
    delete op.lines;
  }
  return ops;
}

const hash = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const DEDUPE_MS = 20000;
// The Codex desktop app fires one message's hooks in several side sessions at once. The first
// firing of a prompt text (any session id) inside the window claims it; the others still get
// the context but write nothing. The claim is an exclusive file create, so it holds across processes.
function claim(c, text, now = Date.now(), windowMs = DEDUPE_MS) {
  const dir = C.configFile(c, 'seen');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, hash(String(text).trim()).slice(0, 32));
  try { fs.writeFileSync(file, String(now), { flag: 'wx' }); prune(dir, now); return true; }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  let at = now;
  try { at = Number(fs.readFileSync(file, 'utf8')) || fs.statSync(file).mtimeMs; } catch (_) { return false; }
  if (now - at < windowMs) return false;
  // A stale claim: the first process to rename it away takes the new claim.
  const stale = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex');
  try { fs.renameSync(file, stale); fs.unlinkSync(stale); } catch (_) { return false; }
  try { fs.writeFileSync(file, String(now), { flag: 'wx' }); return true; } catch (_) { return false; }
}
function prune(dir, now) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name);
      if (now - fs.statSync(f).mtimeMs > 86400000) fs.unlinkSync(f);
    }
  } catch (_) { /* Cleanup is best effort. */ }
}

// Per-session state for the digest: Codex transcripts are not a stable format, so the digest
// is built only from what the hooks themselves receive.
const stateFile = (c, sid) => C.configFile(c, 'codex-sessions', hash(sid) + '.json');
function readState(c, sid) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(c, sid), 'utf8'));
    if (s && typeof s === 'object' && !Array.isArray(s)) return { prompts: [], ...s };
  } catch (_) { /* Missing or broken state starts fresh. */ }
  return { prompts: [] };
}
function writeState(c, sid, state) {
  const file = stateFile(c, sid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

// The command line the model runs after the person says yes. The model's own shell has no
// plugin variables, so the line carries --host codex, which selects the Codex config file
// (~/.continuum/codex/config.json, or CONTINUUM_CONFIG when Codex itself was started with it).
function approveLine(level) {
  return 'node "' + C.pluginPath('scripts', 'approve.js') + '" --host codex ' + level + ' "<their words>"';
}
// The Codex app's own background sessions (suggested next message, memory writer) carry no
// transcript_path; real chats always do (live capture 2026-11-10). A fork start and the two
// known background prompt openings are checked too.
const BACKGROUND_PROMPT = /^\s*(?:This is an app-generated request for a suggested next user message\.|## Memory Writing Agent|Consolidate the supplied rollout summaries)/;
function isBackground(input) {
  if (!input || typeof input !== 'object') return false;
  if (typeof input.transcript_path !== 'string' || !input.transcript_path.trim()) return true;
  if (input.hook_event_name === 'SessionStart' && input.source === 'fork') return true;
  return typeof input.prompt === 'string' && BACKGROUND_PROMPT.test(input.prompt);
}
// Set by session-start when it loaded the whole Working Agreements note (any host); prompt-route
// reads and removes it on the next message so that note is not injected twice.
const fullRulesMarker = (c, sid) => C.configFile(c, 'full-rules', hash(String(sid)).slice(0, 32));
module.exports = { fullRulesMarker, isBackground, patchOps, claim, readState, writeState, approveLine, hash, DEDUPE_MS };
