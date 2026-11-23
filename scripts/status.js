'use strict';
// Read-only install check, mainly for Codex: node status.js --host codex. Prints PASS/FAIL lines
// and never writes anything. Exit code 0 when everything that can be checked passes.
const fs = require('fs');
const path = require('path');
const C = require('./lib/config');
const S = require('./lib/codex-setup');

const norm = p => String(p).replace(/[\\/]+/g, '/').toLowerCase();
// Codex stores each trusted hook as [hooks.state.'<hooks.json path>:<event>:<i>:<j>'] in config.toml.
function trusted(file, total) {
  let text;
  try { text = fs.readFileSync(path.join(S.codexHome(), 'config.toml'), 'utf8'); } catch (_) { return 'cannot tell'; }
  const keys = [...text.matchAll(/^\s*\[hooks\.state\.(?:'([^']+)'|"((?:[^"\\]|\\.)+)")\]/gm)]
    .map(m => (m[1] !== undefined ? m[1] : m[2].replace(/\\\\/g, '\\')).replace(/:[^:]+:\d+:\d+$/, ''));
  const found = keys.filter(k => norm(k) === norm(file)).length;
  if (!found) return 'no';
  return found >= total ? 'yes' : 'no (' + found + ' of ' + total + ')';
}
// Claude: hooks written into Claude's user settings.json by the double-click setup. Checked when the file holds
// Continuum hooks, or when --guided says they are expected; a plugin-route install (none there) is not judged.
function claudeHooks(expected, say) {
  const K = require('./lib/claude-setup');
  let found;
  try { found = K.inspect(); } catch (e) {
    say(expected ? false : null, 'claude settings ' + K.settingsFile() + ' cannot be read (' + e.message + ')');
    return;
  }
  if (!found.entries.length) {
    if (expected) say(false, 'claude hooks: none in ' + found.file + (found.exists ? '' : ' (the file does not exist)'));
    return;
  }
  say(true, 'claude settings ' + found.file + ' readable');
  const scripts = found.entries.map(K.target).filter((s, i, a) => a.indexOf(s) === i);
  const missing = scripts.filter(s => !fs.existsSync(C.normalize(s)));
  say(!missing.length, 'claude hooks: ' + found.entries.length + ' Continuum hook(s) in ' + found.file +
    (missing.length ? ', missing script(s): ' + missing.join(', ') : ', every script exists'));
  const nodes = [...new Set(found.entries.map(h => h.command))];
  const badNode = nodes.filter(n => typeof n !== 'string' || (path.isAbsolute(n) && !fs.existsSync(n)));
  say(!badNode.length, 'claude hooks node: ' + (badNode.length ? 'missing ' + badNode.join(', ') : nodes.join(', ') + (nodes.every(n => path.isAbsolute(n)) ? ' exists' : ' (a name, not a path: not checked)')));
}
function check() {
  const lines = [];
  let ok = true;
  const say = (pass, text) => { lines.push((pass === null ? 'INFO ' : pass ? 'PASS ' : 'FAIL ') + text); if (pass === false) ok = false; };
  const major = Number(process.versions.node.split('.')[0]);
  say(major >= 20, 'node version ' + process.versions.node + (major >= 20 ? '' : ' (20 or later is needed)'));
  let c = null;
  try { c = C.load(); say(true, 'config found and valid: ' + C.configPath()); }
  catch (e) { say(false, 'config: ' + C.configPath() + ' (' + e.message + ')'); }
  if (c) {
    const start = path.join(c.vault, c.inject.startPage);
    say(fs.existsSync(c.vault) && fs.existsSync(start), 'vault folder ' + c.vault + (fs.existsSync(start) ? ' has ' + c.inject.startPage : ' is missing ' + c.inject.startPage));
    // Information only: a note over the limit is loaded in part with a notice, so nothing is broken.
    const F = require('./lib/filing');
    try { F.report(c).forEach(line => say(null, line)); } catch (e) { say(null, 'note sizes: cannot tell (' + e.message + ')'); }
    // An unfinished split is broken state (notes may be half moved); a lock left with nothing written is only reported.
    try { F.unfinishedLines(c).forEach(l => say(l.fail ? false : null, l.text)); } catch (e) { say(null, 'split lock: cannot tell (' + e.message + ')'); }
  }
  if (C.host.isCodex()) {
    const files = [c ? S.projectFile(c.vault) : null, S.userFile()].filter(f => f && fs.existsSync(f));
    if (!files.length) say(false, 'hooks file: none found (run setup with --host codex)');
    for (const file of files) {
      let data;
      try { data = S.readHooks(file); } catch (e) { say(false, 'hooks file ' + file + ' cannot be read (' + e.message + ')'); continue; }
      const handlers = Object.values(data.hooks || {}).flatMap(gs => gs.flatMap(g => g.hooks || [])).filter(S.ours);
      const missing = handlers.map(h => (h.command.match(/^\s*node\s+"([^"]+)"/) || [])[1])
        .filter(script => !script || !fs.existsSync(C.normalize(script)));
      say(handlers.length > 0 && !missing.length, 'hooks file ' + file + ': ' + handlers.length + ' Continuum hook(s)' +
        (missing.length ? ', missing script(s): ' + missing.join(', ') : ', every script exists'));
      const t = handlers.length ? trusted(file, handlers.length) : 'no';
      say(t === 'cannot tell' ? null : t === 'yes', 'hooks trusted in Codex: ' + t);
    }
  }
  if (C.host.isHermes()) require('./lib/hermes-setup').check(process.argv.slice(2), c, say);
  if (C.host.isAntigravity()) require('./lib/antigravity-setup').check(c, say);
  if (C.host.name() === 'claude') claudeHooks(process.argv.slice(2).includes('--guided'), say);
  return { ok, lines };
}
if (require.main === module) {
  try {
    const { ok, lines } = check();
    lines.forEach(l => console.log(l));
    process.exitCode = ok ? 0 : 1;
  } catch (e) { console.error('FAIL status: ' + e.message); process.exitCode = 1; }
}
module.exports = { check, trusted };
