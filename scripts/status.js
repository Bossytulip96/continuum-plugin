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
