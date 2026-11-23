'use strict';
// Google Antigravity install steps for setup.js --host antigravity and status.js --host antigravity.
// --hooks plugin (default): no hooks file is written; Antigravity runs the installed plugin folder's own hooks.json
// (the folder sits in <gemini home>/config/plugins, or in .agents/plugins of the workspace).
// --hooks global: a "continuum" group with this folder's absolute path goes into <gemini home>/config/hooks.json.
// Setup never copies or installs the plugin folder and never touches Antigravity's config.json.
const fs = require('fs');
const path = require('path');
const os = require('os');
const C = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');
const GROUP = 'continuum';
const slash = p => String(p).split(path.sep).join('/');
// CONTINUUM_GEMINI_HOME overrides the Gemini home (tests, or a moved profile); the default is ~/.gemini.
const geminiHome = () => path.resolve(C.normalize(process.env.CONTINUUM_GEMINI_HOME ||
  path.join(process.env.USERPROFILE || os.homedir(), '.gemini')));
const globalFile = () => path.join(geminiHome(), 'config', 'hooks.json');
const pluginHooks = () => path.join(ROOT, 'hooks.json');
const installedDir = () => path.join(geminiHome(), 'config', 'plugins', 'continuum');
const render = data => JSON.stringify(data, null, 2) + '\n';
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
function readHooks(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(file + ' is not a hooks file');
  return data;
}
// The plugin's group, with the relative ./scripts/ path made absolute (a global hook does not run in the plugin folder).
function generated() {
  const group = JSON.parse(JSON.stringify(readHooks(pluginHooks())[GROUP]));
  for (const h of handlers(group)) {
    h.command = h.command.replace(/^node \.\/scripts\/(\S+)/, (_, s) => 'node "' + slash(ROOT) + '/scripts/' + s + '"');
  }
  return group;
}
// Every command handler in a group, whatever the event's shape (flat list, or matcher entries with hooks).
function handlers(group) {
  return Object.values(group && typeof group === 'object' ? group : {}).filter(Array.isArray)
    .flatMap(list => list.flatMap(h => (h && Array.isArray(h.hooks) ? h.hooks : [h]))).filter(h => h && typeof h.command === 'string');
}
const script = h => (h.command.match(/^\s*node\s+(?:"([^"]+)"|(\S+))/) || []).slice(1).find(Boolean) || '';
// The copy never replaces an earlier copy: two changes in the same second get two names.
function backupCopy(file) {
  for (let i = 0; ; i++) {
    const copy = file + '.bak-' + stamp() + (i ? '-' + i : '');
    try { fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL); return copy; }
    catch (e) { if (e.code !== 'EEXIST' || i >= 50) throw e; }
  }
}
function install(file = globalFile()) {
  const exists = fs.existsSync(file);
  const data = exists ? readHooks(file) : {};
  const next = { ...data, [GROUP]: generated() };
  const text = render(next);
  if (exists && fs.readFileSync(file, 'utf8') === text) return ['Antigravity hooks unchanged: ' + file];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const copy = exists ? backupCopy(file) : null;
  const others = Object.keys(data).filter(k => k !== GROUP).length;
  fs.writeFileSync(file, text, 'utf8');
  return ['Antigravity hooks ' + (exists ? 'updated' : 'written') + ': ' + file + (others ? ' (' + others + ' other hook group(s) kept)' : ''),
    ...(copy ? ['The file as it was is kept at ' + copy + '.'] : [])];
}
function uninstall(file = globalFile()) {
  if (!fs.existsSync(file)) return [];
  const data = readHooks(file);
  if (!(GROUP in data)) return ['No Continuum hook group in ' + file + '; left as it is.'];
  const copy = backupCopy(file);
  const { [GROUP]: _, ...left } = data;
  if (!Object.keys(left).length) {
    fs.unlinkSync(file);
    return ['Removed ' + file + ' (it held only the Continuum group). Copy kept at ' + copy + '.'];
  }
  fs.writeFileSync(file, render(left), 'utf8');
  return ['Removed the Continuum group from ' + file + '; other groups kept. Copy kept at ' + copy + '.'];
}
const NEXT = ['Three steps left, in Antigravity:',
  '1. Quit Antigravity completely and open it again.',
  '2. Open your vault folder as the workspace.',
  '3. Ask "What are my standing rules?" If the answer quotes your vault, Continuum is working.'];
function parse(args) {
  const rest = [];
  let hooks = 'plugin';
  let remove = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remove') { remove = true; continue; }
    if (args[i] === '--hooks') {
      hooks = String(args[++i] || '').toLowerCase();
      if (!['plugin', 'global'].includes(hooks)) throw new Error('Use --hooks plugin or global');
      continue;
    }
    rest.push(args[i]);
  }
  // The allowed-folder question is about Claude Code's settings; setup.js asks for it on every host.
  if (!rest.includes('--allow-folder')) rest.push('--allow-folder', 'no');
  return { rest, hooks, remove };
}
function run(args, setup) {
  const { rest, hooks, remove } = parse(args);
  if (remove) {
    const lines = uninstall();
    for (const line of lines.length ? lines : ['No Continuum hooks in ' + globalFile() + '.']) console.log(line);
    console.log('An installed Continuum plugin is removed in Antigravity itself. The vault and the config are left untouched.');
    return;
  }
  setup(rest);
  if (hooks === 'global') {
    install().forEach(l => console.log(l));
    console.log('Warning: hooks in ' + globalFile() + ' run in every Antigravity chat on this computer. ' +
      'Do not also enable the Continuum plugin, or every hook runs twice.');
  } else console.log('No hooks file written (--hooks plugin): Antigravity runs the hooks.json of the installed plugin folder.');
  NEXT.forEach(l => console.log(l));
}
// status.js --host antigravity: PASS/FAIL lines, read only.
function check(c, say) {
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.antigravity-plugin', 'plugin.json'), 'utf8')); } catch (_) { /* reported */ }
  say(Boolean(manifest && manifest.name === 'continuum'), 'plugin manifest ' + path.join(ROOT, '.antigravity-plugin', 'plugin.json'));
  const sources = [];
  // Antigravity loads a plugin folder from two places: its global plugins folder, and .agents/plugins in a
  // workspace (here the vault, the workspace setup tells the person to open).
  // Without a valid config (reported above by status.js) there is no vault to look in; the other places still count.
  const workspaceDir = c ? path.join(c.vault, '.agents', 'plugins', 'continuum') : null;
  if (C.covers(path.join(geminiHome(), 'config', 'plugins'), ROOT) || /[\\/]\.agents[\\/]plugins[\\/][^\\/]+$/i.test(ROOT)) sources.push(pluginHooks());
  else for (const dir of [installedDir(), workspaceDir]) if (dir && fs.existsSync(dir)) sources.push(path.join(dir, 'hooks.json'));
  if (fs.existsSync(globalFile())) sources.push(globalFile());
  let found = 0;
  let places = 0;
  for (const file of sources) {
    let group;
    try { group = readHooks(file)[GROUP]; } catch (e) { say(false, 'hooks file ' + file + ' cannot be read (' + e.message + ')'); continue; }
    if (!group) { if (file === globalFile()) say(null, 'hooks file ' + file + ': no Continuum group'); continue; }
    const list = handlers(group);
    const base = path.dirname(file);
    const missing = list.map(script).filter(s => !s || !fs.existsSync(path.resolve(base, C.normalize(s))));
    found += list.length;
    if (list.length) places++;
    say(list.length > 0 && !missing.length, 'hooks file ' + file + ': ' + list.length + ' Continuum hook(s)' +
      (missing.length ? ', missing script(s): ' + missing.join(', ') : ', every script exists'));
    if (group.enabled === false) say(false, 'hooks file ' + file + ': the Continuum group is turned off (enabled: false)');
  }
  if (!found) say(false, 'Antigravity hooks: none found (install the plugin, or run setup with --host antigravity --hooks global)');
  if (places > 1) say(null, 'Continuum hooks are both in the plugin and in ' + globalFile() + '; each would run twice');
}
module.exports = { run, install, uninstall, generated, handlers, check, geminiHome, globalFile, installedDir, readHooks };
