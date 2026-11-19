'use strict';
// Hermes Agent install steps for setup.js --host hermes and status.js --host hermes. The adapter in
// the package's hermes/ folder is copied to <hermes-home>/plugins/continuum/ with a sidecar file
// that tells it where the package, node and the config are. Hermes's own config.yaml is only read.
const fs = require('fs');
const path = require('path');
const C = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['session-start.js', 'prompt-route.js', 'action-gate.js', 'session-digest.js', 'decision-log.js'];
const version = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const installed = home => path.join(home, 'plugins', 'continuum');
function take(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(name + ' needs a value');
  args.splice(i, 2);
  return value;
}
// Plain text reading of Hermes's config.yaml: is continuum under plugins: enabled:? true/false/null.
function enabled(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex(l => /^plugins:\s*(#.*)?$/.test(l));
  if (start < 0) return null;
  let inList = false;
  let listIndent = -1;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^(\s+)enabled:\s*(.*)$/);
    if (m) {
      if (m[2].trim().startsWith('[')) return /[[,\s'"]continuum['",\s\]]/.test(m[2]);
      inList = true; listIndent = m[1].length; continue;
    }
    if (inList) {
      const item = line.match(/^(\s*)-\s*['"]?([^'"#\s]+)/);
      if (item && item[1].length >= listIndent) { if (item[2] === 'continuum') return true; continue; }
      if (line.trim() && !line.trim().startsWith('#')) inList = false;
    }
  }
  return inList || lines.slice(start + 1).some(l => /^\s+enabled:/.test(l)) ? false : null;
}
function spill(text) {
  const m = String(text).match(/output_spill:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+max_chars:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
function readYaml(home) {
  try { return fs.readFileSync(path.join(home, 'config.yaml'), 'utf8'); } catch (_) { return null; }
}
function moveAside(home) {
  const dest = installed(home);
  if (!fs.existsSync(dest)) return null;
  const aside = path.join(home, 'backups', 'plugins', 'continuum-' + stamp());
  fs.mkdirSync(path.dirname(aside), { recursive: true });
  fs.renameSync(dest, aside);
  return aside;
}
function run(argv, setup) {
  const args = [...argv];
  const remove = args.includes('--remove');
  if (remove) args.splice(args.indexOf('--remove'), 1);
  const homeArg = take(args, '--hermes-home');
  if (!homeArg) throw new Error('Use --hermes-home <the Hermes home folder>');
  const home = path.resolve(C.normalize(homeArg));
  const node = take(args, '--node');
  const digests = take(args, '--digests');
  if (digests !== undefined && !['full', 'summary'].includes(digests)) throw new Error('Use --digests full or summary');
  if (remove) {
    const aside = moveAside(home);
    console.log(aside ? 'Continuum adapter moved out of Hermes plugins to ' + aside + '.' : 'No Continuum adapter installed in ' + home + '.');
    console.log('The vault and the config are left untouched. Restart the Hermes gateway and dashboard.');
    return;
  }
  const c = setup(args);
  if (digests) {
    const saved = JSON.parse(fs.readFileSync(c.configPath, 'utf8'));
    saved.inject = { ...(saved.inject || {}), digests };
    C.validate(saved, c.configPath);
    fs.writeFileSync(c.configPath, JSON.stringify(saved, null, 2) + '\n', 'utf8');
  }
  const aside = moveAside(home);
  const dest = installed(home);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(path.join(ROOT, 'hermes'), dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'continuum.json'), JSON.stringify({ root: ROOT,
    node: node || process.execPath, config: c.configPath }, null, 2) + '\n', 'utf8');
  if (aside) console.log('The adapter that was there is kept at ' + aside + '.');
  console.log('Hermes adapter installed: ' + dest);
  const yaml = readYaml(home);
  const on = yaml === null ? null : enabled(yaml);
  const steps = [];
  if (on !== true) steps.push('Turn the plugin on: run hermes plugins enable continuum. If that command fails on your install, ' +
    'add continuum to the list under plugins, enabled in Hermes\'s config.yaml by hand.');
  if ((digests || c.inject.digests) === 'full') {
    const limit = yaml === null ? null : spill(yaml);
    if (!(limit >= 100000)) steps.push('Full digests are on: raise hooks, output_spill, max_chars in config.yaml to at least 100000' +
      (limit ? ' (it is ' + limit + ' now).' : '.'));
  }
  steps.push('Restart the Hermes gateway and the dashboard.');
  steps.push('Ask "What are my standing rules?" If the answer quotes your vault, Continuum is working.');
  console.log('Steps left:');
  steps.forEach((s, i) => console.log((i + 1) + '. ' + s));
}
// Read-only checks for status.js --host hermes. say(pass|null, text).
function check(argv, c, say) {
  const args = [...argv];
  const homeArg = take(args, '--hermes-home');
  if (!homeArg) { say(false, 'Hermes home: pass --hermes-home <folder>'); return; }
  const home = path.resolve(C.normalize(homeArg));
  const dest = installed(home);
  const ok = fs.existsSync(path.join(dest, '__init__.py')) && fs.existsSync(path.join(dest, 'plugin.yaml'));
  say(ok, 'adapter installed: ' + dest);
  let side = null;
  try { side = JSON.parse(fs.readFileSync(path.join(dest, 'continuum.json'), 'utf8')); } catch (_) { /* reported below */ }
  const missing = side && side.root ? SCRIPTS.filter(s => !fs.existsSync(path.join(side.root, 'scripts', s))) : SCRIPTS;
  say(Boolean(side && side.root) && !missing.length, 'sidecar ' + path.join(dest, 'continuum.json') +
    (side && side.root ? (missing.length ? ' points at missing script(s): ' + missing.join(', ') : ' points at scripts that exist') : ' missing or unreadable'));
  if (side && side.config && c) say(path.resolve(side.config) === path.resolve(c.configPath), 'sidecar config is ' + side.config);
  let v = null;
  try { v = (fs.readFileSync(path.join(dest, 'plugin.yaml'), 'utf8').match(/^version:\s*["']?([^"'\s]+)/m) || [])[1]; } catch (_) { /* below */ }
  say(v === version(), 'adapter version ' + (v || 'unknown') + ', package version ' + version());
  const yaml = readYaml(home);
  const on = yaml === null ? null : enabled(yaml);
  say(on === null ? null : on, 'continuum under plugins: enabled: in config.yaml: ' + (on === null ? 'cannot tell' : on ? 'yes' : 'no'));
  const limit = yaml === null ? null : spill(yaml);
  say(null, 'hooks.output_spill.max_chars: ' + (limit === null ? 'not found' : limit));
}
module.exports = { run, check, enabled, spill, installed };
