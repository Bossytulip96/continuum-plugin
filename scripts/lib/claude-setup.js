'use strict';
// Claude desktop app install steps run by setup.js (claude host) with --hooks user or --remove: Continuum's
// hook entries go straight into the "hooks" key of Claude's user settings.json (CLAUDE_CONFIG_DIR, else
// %USERPROFILE%\.claude), in exec form with this folder's absolute paths and the node.exe running setup.
// The plugin route (hooks/hooks.json) is not used here. Every other key and hook in the file is kept.
const fs = require('fs');
const path = require('path');
const os = require('os');
const C = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');
const slash = p => String(p).split(path.sep).join('/');
const plain = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const settingsFile = () => path.join(path.resolve(C.normalize(process.env.CLAUDE_CONFIG_DIR ||
  path.join(process.env.USERPROFILE || os.homedir(), '.claude'))), 'settings.json');
const template = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const SCRIPTS = [...new Set(Object.values(template()).flatMap(gs => gs.flatMap(g => g.hooks.map(h => path.posix.basename(h.args[0])))))];
// The script path an entry runs: its first argument (exec form), else the first .js path in its command string.
function target(h) {
  if (!plain(h)) return '';
  if (Array.isArray(h.args) && typeof h.args[0] === 'string') return slash(h.args[0]);
  const m = typeof h.command === 'string' && h.command.match(/"([^"]+\.js)"|(\S+\.js)/);
  return m ? slash(m[1] || m[2]) : '';
}
// Ours: it runs a script in this program folder's scripts/, or one of Continuum's hook scripts from a scripts/
// folder inside a folder whose path names Continuum (an older or moved program folder, so it gets replaced).
function ours(h) {
  const t = target(h).toLowerCase();
  if (!t) return false;
  if (t.startsWith((slash(ROOT) + '/scripts/').toLowerCase())) return true;
  const m = t.match(/^(.*)\/scripts\/([a-z-]+\.js)$/);
  return Boolean(m && SCRIPTS.includes(m[2]) && /continuum/.test(m[1]));
}
// hooks/hooks.json with ${CLAUDE_PLUGIN_ROOT} made absolute and "node" made the absolute node path.
function generated(nodePath = process.execPath) {
  const out = {};
  for (const [event, groups] of Object.entries(template())) {
    out[event] = groups.map(g => ({ ...g, hooks: g.hooks.map(h => ({ ...h, command: nodePath,
      args: h.args.map(a => a.split('${CLAUDE_PLUGIN_ROOT}').join(slash(ROOT))) })) }));
  }
  return out;
}
function read(file) {
  if (!fs.existsSync(file)) return {};
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim() || '{}'); } catch (_) { data = null; }
  if (!plain(data) || (data.hooks !== undefined && !plain(data.hooks))) {
    throw new Error('Claude\'s settings file ' + file + ' could not be read as settings (it is not valid JSON, or its hooks part is not a list of events), so it was left alone');
  }
  return data;
}
// Drops Continuum's entries, then groups and events left empty; everything else stays as it was.
function without(hooks) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    if (!Array.isArray(groups)) { out[event] = groups; continue; }
    const kept = groups.map(g => plain(g) && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter(h => !ours(h)) } : g)
      .filter(g => !plain(g) || !Array.isArray(g.hooks) || g.hooks.length);
    if (kept.length) out[event] = kept;
  }
  return out;
}
const handlers = hooks => Object.entries(hooks || {}).flatMap(([event, gs]) => (Array.isArray(gs) ? gs : [])
  .flatMap(g => plain(g) && Array.isArray(g.hooks) ? g.hooks.map(h => ({ event, matcher: g.matcher, h })) : []));
const mine = hooks => handlers(hooks).filter(x => ours(x.h)).map(x => JSON.stringify([x.event, x.matcher || '', x.h])).sort();
const count = hooks => handlers(hooks).length;
function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-'); }
// The dated copy goes in Continuum's settings folder, not next to Claude's file.
function keepCopy(file) {
  const dir = path.join(path.dirname(C.configPath()), 'claude-settings-copies');
  fs.mkdirSync(dir, { recursive: true });
  let copy = path.join(dir, 'settings-' + stamp() + '.json');
  for (let n = 2; fs.existsSync(copy); n++) copy = path.join(dir, 'settings-' + stamp() + '-' + n + '.json');
  fs.copyFileSync(file, copy);
  return copy;
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  // wx: never write through a file or link that is already sitting at the temporary name.
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tmp, file);
}
// Writes or merges Continuum's entries. Returns the lines to print.
function install(file = settingsFile(), nodePath = process.execPath) {
  const data = read(file);
  const fresh = generated(nodePath);
  if (JSON.stringify(mine(data.hooks)) === JSON.stringify(mine(fresh))) return ['Claude hooks unchanged: ' + file];
  const hooks = without(data.hooks);
  const foreign = count(hooks);
  for (const [event, groups] of Object.entries(fresh)) hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), ...groups];
  const copy = fs.existsSync(file) ? keepCopy(file) : null;
  write(file, { ...data, hooks });
  return ['Claude hooks written: ' + file + ' (' + count(fresh) + ' Continuum hook(s); ' + foreign + ' other hook(s) kept)',
    ...(copy ? ['The file as it was is kept at ' + copy + '.'] : [])];
}
function uninstall(file = settingsFile()) {
  if (!fs.existsSync(file)) return ['No Claude settings file at ' + file + '; nothing to remove.'];
  const data = read(file);
  if (!mine(data.hooks).length) return ['No Continuum hooks in ' + file + '; left as it is.'];
  const copy = keepCopy(file);
  const hooks = without(data.hooks);
  const next = { ...data, hooks };
  if (!Object.keys(hooks).length) delete next.hooks;
  write(file, next);
  return ['Removed Continuum hooks from ' + file + '; everything else in it kept. Copy kept at ' + copy + '.'];
}
// Read-only, for status.js: what the settings file holds of ours.
function inspect(file = settingsFile()) {
  if (!fs.existsSync(file)) return { file, exists: false, entries: [] };
  const data = read(file);
  return { file, exists: true, entries: handlers(data.hooks).filter(x => ours(x.h)).map(x => x.h) };
}
function parse(args) {
  const rest = [];
  let hooks = null;
  let remove = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remove') { remove = true; continue; }
    if (args[i] === '--hooks') {
      hooks = String(args[++i] || '').toLowerCase();
      if (!['user', 'none'].includes(hooks)) throw new Error('Use --hooks user or none');
      continue;
    }
    rest.push(args[i]);
  }
  return { rest, hooks, remove };
}
function run(args, setup) {
  const { rest, hooks, remove } = parse(args);
  if (remove) {
    uninstall().forEach(l => console.log(l));
    console.log('The vault and the config are left untouched.');
    return;
  }
  setup(rest);
  if (hooks === 'user') install().forEach(l => console.log(l));
  else console.log('No Claude hooks written (--hooks none).');
}
const wanted = args => args.includes('--remove') || args.includes('--hooks');
module.exports = { run, wanted, install, uninstall, inspect, generated, ours, settingsFile, target, SCRIPTS, ROOT };
