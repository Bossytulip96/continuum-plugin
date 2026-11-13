'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const blocked = JSON.parse(Buffer.from('WyJORVNUIiwibmVzdG55IiwibmVzdG5ld3lvcmsiLCJKb3ljZSIsIlJpdmVyYSIsInVjMDk5IiwidWMwOTkwIiwiQm9zc3lUdWxpcCIsIkJvc3N5dHVsaXA5NiIsIkc6XFxNeSBEcml2ZSIsIkc6L015IERyaXZlIiwiTXkgRHJpdmUiLCJHb3JnaWFzIiwiU2hvcGlmeSIsIkxvb3AgUmV0dXJucyIsIkFsaGVuYSIsIkZsaXAiLCJSZWRvIiwiTWFsb21vIiwiV3lzZSIsIkFJQk9YIiwiYWlib3giLCJuZXdwYyIsInRhaWwwMjc2NmUiLCIxMDAuNjYuIiwiU21hcnQgRmluZHMiLCJEdWV0IiwiS29rb3JvIiwianJpdmVyYSIsIkludHJpbnNpYyIsIkF1cmEiLCJPeG5hcmQiLCJAZ21haWwuY29tIiwib25yZW5kZXIuY29tIiwiYXBpX2tleSIsImFwaWtleSIsInNrLSIsInRva2VuPSJd', 'base64').toString('utf8'));
const excluded = new Set(['PLAN.md', 'HOOK-CONTRACT.md', 'STATUS.md', 'CODEX-PROMPT.txt', 'CODEX-REPORT.txt', 'codex-stderr.txt', 'codex-stream.jsonl']);
const failures = [];
let files = 0;
function inspectFields(value, file) {
  if (!value || typeof value !== 'object') return;
  for (const [name, item] of Object.entries(value)) {
    if (/^(key|secret)$/i.test(name)) failures.push(file + ': forbidden credential field');
    inspectFields(item, file);
  }
}
function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative === '.git' || excluded.has(relative)) continue;
    if (entry.isSymbolicLink()) { failures.push(relative + ': symbolic link is not a shipped file'); continue; }
    if (entry.isDirectory()) { walk(file); continue; }
    files++;
    const bytes = fs.readFileSync(file);
    const text = bytes.toString('utf8');
    const searchable = (relative + '\n' + text).toLowerCase();
    blocked.forEach((term, i) => {
      const t = term.toLowerCase();
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const word = /^[a-z0-9]+$/.test(t) ? new RegExp('(?<![a-z0-9])' + escaped + '(?![a-z0-9])') : new RegExp(escaped);
      if (word.test(searchable)) failures.push(relative + ': prohibited term #' + (i + 1));
    });
    if (bytes.length > 200 * 1024) failures.push(relative + ': exceeds 200 KB');
    if (/\.env(?:\.|$)/i.test(entry.name) || /\.bak$/i.test(entry.name)) failures.push(relative + ': forbidden file extension');
    if (/\.json$/i.test(entry.name)) {
      try { inspectFields(JSON.parse(text), relative); }
      catch { failures.push(relative + ': invalid JSON'); }
    }
    // The plugin icon is the one binary file: size and name are checked, line count is not.
    if (/\.png$/i.test(entry.name) && relative !== '.claude-plugin/icon.png') failures.push(relative + ': only the plugin icon may be a PNG');
    if (!/\.png$/i.test(entry.name) &&
        text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0) >= 300) failures.push(relative + ': requires fewer than 300 lines');
  }
}
try { walk(root); } catch (error) { failures.push(error.message); }
if (failures.length) {
  console.error('FAIL leakscan (' + files + ' files)');
  failures.forEach(line => console.error(line));
  process.exitCode = 1;
} else {
  console.log('PASS leakscan: ' + files + ' shipped files; ' + blocked.length + ' prohibited terms; size, fields, extensions and line limits');
}
