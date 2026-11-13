'use strict';
// Codex install steps run by setup.js --host codex: the hooks file (Codex does not load a
// plugin's own hooks, so they go in the vault project's .codex/hooks.json, or the user one),
// AGENTS.md for the vault, and --remove. Claude Code never reaches this file.
const fs = require('fs');
const path = require('path');
const os = require('os');
const C = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');
const slash = p => String(p).split(path.sep).join('/');
const rootSlash = () => slash(ROOT);
const codexHome = () => path.resolve(C.normalize(process.env.CODEX_HOME ||
  path.join(process.env.USERPROFILE || os.homedir(), '.codex')));
const projectFile = vault => path.join(vault, '.codex', 'hooks.json');
const userFile = () => path.join(codexHome(), 'hooks.json');
// A Continuum entry: its command runs a script from this plugin folder with --host codex.
const ours = h => Boolean(h && typeof h.command === 'string' &&
  h.command.toLowerCase().includes((rootSlash() + '/scripts/').toLowerCase()) && /--host codex\b/.test(h.command));

// The template is hooks/codex-hooks.json with ${PLUGIN_ROOT} made absolute and no description.
function generated() {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'codex-hooks.json'), 'utf8'));
  const text = JSON.stringify({ hooks: t.hooks }).split('${PLUGIN_ROOT}').join(rootSlash().replace(/"/g, '\\"'));
  return JSON.parse(text);
}
const render = data => JSON.stringify(data, null, 2) + '\n';
function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-'); }
function readHooks(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data.hooks !== undefined && (typeof data.hooks !== 'object' || Array.isArray(data.hooks)))) {
    throw new Error(file + ' is not a hooks file');
  }
  return data;
}
// Drops Continuum's entries (and groups left empty); everything else stays as it was.
function without(data) {
  const out = { ...data, hooks: {} };
  for (const [event, groups] of Object.entries(data.hooks || {})) {
    const kept = (Array.isArray(groups) ? groups : []).map(g => ({ ...g,
      hooks: (Array.isArray(g.hooks) ? g.hooks : []).filter(h => !ours(h)) })).filter(g => g.hooks.length);
    if (kept.length) out.hooks[event] = kept;
  }
  return out;
}
const count = data => Object.values(data.hooks || {}).reduce((n, gs) => n + gs.reduce((m, g) => m + (g.hooks || []).length, 0), 0);
function backupCopy(file) {
  const copy = file + '.bak-' + stamp();
  fs.copyFileSync(file, copy);
  return copy;
}
// Writes or merges one hooks file. Returns the lines to print.
function install(file) {
  const fresh = generated();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, render(fresh), 'utf8');
    return ['Codex hooks written: ' + file];
  }
  const before = fs.readFileSync(file, 'utf8');
  if (before === render(fresh)) return ['Codex hooks unchanged: ' + file + ' (trust is kept)'];
  const current = readHooks(file);
  const merged = without(current);
  const foreign = count(merged);
  for (const [event, groups] of Object.entries(fresh.hooks)) merged.hooks[event] = [...(merged.hooks[event] || []), ...groups];
  const text = foreign || Object.keys(merged).some(k => k !== 'hooks') ? render(merged) : render(fresh);
  if (text === before) return ['Codex hooks unchanged: ' + file + ' (trust is kept)'];
  const copy = backupCopy(file);
  fs.writeFileSync(file, text, 'utf8');
  return ['Codex hooks updated: ' + file + (foreign ? ' (merged; ' + foreign + ' other hook(s) kept)' : ''),
    'The file as it was is kept at ' + copy + '.',
    'The hooks changed, so Codex will ask you to Trust them again (Settings > Hooks).'];
}
function uninstall(file) {
  if (!fs.existsSync(file)) return [];
  const current = readHooks(file);
  const left = without(current);
  if (count(left) === count(current)) return ['No Continuum hooks in ' + file + '; left as it is.'];
  const copy = backupCopy(file);
  const others = Object.keys(left).filter(k => k !== 'hooks' && k !== 'description');
  if (!count(left) && !others.length) {
    fs.unlinkSync(file);
    return ['Removed ' + file + ' (it held only Continuum hooks). Copy kept at ' + copy + '.'];
  }
  if (!count(left)) delete left.hooks;
  fs.writeFileSync(file, render(left), 'utf8');
  return ['Removed Continuum hooks from ' + file + '; other hooks kept. Copy kept at ' + copy + '.'];
}
function agents(c) {
  const file = C.vaultPath(c, 'AGENTS.md');
  if (fs.existsSync(file)) return 'AGENTS.md already exists; left as it is.';
  const body = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'codex-agents.md'), 'utf8')
    .replace(/<plugin folder>/g, () => rootSlash()).replace(/\{\{person\}\}/g, () => c.person).replace(/\{\{date\}\}/g, C.date(c))
    .replace(/\{\{approve\}\}/g, 'node "' + rootSlash() + '/scripts/approve.js" --host codex <level> "<their words>"');
  fs.writeFileSync(file, body, { encoding: 'utf8', flag: 'wx' });
  return 'AGENTS.md written: ' + file;
}
const NEXT = ['Five steps left, in the Codex app:',
  '1. Quit the Codex app completely (File > Quit) and open it again.',
  '2. File > Open Folder, and choose your vault folder.',
  '3. Settings > Hooks, find your vault folder, and click Trust all.',
  '4. At the message box, pick "On your computer" (the cloud or computer icon at the right end). Codex remembers it.',
  '5. Ask "What are my standing rules?" If the answer quotes your vault, Continuum is working.'];
function parse(args) {
  const rest = [];
  let hooks = 'project';
  let remove = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remove') { remove = true; continue; }
    if (args[i] === '--hooks') {
      hooks = String(args[++i] || '').toLowerCase();
      if (!['project', 'user', 'none'].includes(hooks)) throw new Error('Use --hooks project, user or none');
      continue;
    }
    rest.push(args[i]);
  }
  return { rest, hooks, remove };
}
function run(args, setup) {
  const { rest, hooks, remove } = parse(args);
  if (remove) {
    let c = null;
    try { c = C.load(); } catch (_) { /* no config: only the user file can be found */ }
    const lines = [...(c ? uninstall(projectFile(c.vault)) : []), ...uninstall(userFile())];
    for (const line of lines.length ? lines : ['No Continuum hooks file found.']) console.log(line);
    console.log('The vault and the config are left untouched.');
    return;
  }
  const c = setup(rest);
  if (hooks === 'project') install(projectFile(c.vault)).forEach(l => console.log(l));
  if (hooks === 'user') {
    install(userFile()).forEach(l => console.log(l));
    console.log('Warning: hooks in ' + userFile() + ' run in every local Codex chat on this computer, not only in the vault.');
  }
  if (hooks === 'none') console.log('No Codex hooks file written (--hooks none).');
  console.log(agents(c));
  NEXT.forEach(l => console.log(l));
}
module.exports = { run, install, uninstall, generated, ours, projectFile, userFile, codexHome, count, readHooks };
