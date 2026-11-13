'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./config');

function readFm(text) {
  const m = String(text).replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!item) continue;
    let value = item[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch (_) { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    fm[item[1]] = value;
  }
  return fm;
}
function setFm(text, values) {
  let normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) return text;
  let head = m[1];
  for (const [name, value] of Object.entries(values)) {
    const line = name + ': ' + JSON.stringify(value);
    const rx = new RegExp('^' + name + ':.*$', 'm');
    head = rx.test(head) ? head.replace(rx, () => line) : head + '\n' + line;
  }
  return '---\n' + head + '\n---\n' + normalized.slice(m[0].length);
}
function list(c, subdir = '') {
  const result = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      // Plain join: dir is already inside the vault (the start folder is checked once below) and
      // links are skipped above, so no per-entry containment check. That check costs a realpath
      // per entry, which took 11 s on a 2,000-file vault on a network drive.
      const file = path.join(dir, entry.name);
      // Dated copies of notes (Reference/History/<stamp>/...) keep their frontmatter, so they are
      // never listed: not routed, not indexed, not counted as duplicates. Dot-folders (.backups) neither.
      if (entry.isDirectory() && /^reference\/history$/i.test(path.relative(c.vault, file).split(path.sep).join('/'))) continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        // One unreadable or oversized note must not take the whole vault down with it.
        try {
          if (fs.statSync(file).size > 2 * 1024 * 1024) continue;
          const text = fs.readFileSync(file, 'utf8');
          result.push({ file, rel: path.relative(c.vault, file).split(path.sep).join('/'),
            name: path.basename(file, path.extname(file)), text, fm: readFm(text) || {} });
        } catch (e) { C.logError(e); }
      }
    }
  }
  walk(C.vaultPath(c, subdir));
  return result;
}
function words(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}
function matches(terms, prompt) {
  const present = new Set(words(prompt));
  return String(terms || '').split(',').filter(term => {
    const required = words(term);
    return required.length && required.every(word => present.has(word));
  }).length;
}
function cell(value) { return String(value || '').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' '); }
function buildIndex(c) {
  const entries = list(c).filter(e => e.rel !== 'Log/index.md');
  const lines = ['# Vault index', '', '| note | type | pattern | when_to_use | about |',
    '|---|---|---|---|---|'];
  for (const e of entries) {
    const link = '../' + e.rel.split('/').map(encodeURIComponent).join('/');
    lines.push('| [' + cell(e.name) + '](' + link + ') | ' +
      ['type', 'pattern', 'when_to_use', 'about'].map(k => cell(e.fm[k])).join(' | ') + ' |');
  }
  const target = C.vaultPath(c, 'Log', 'index.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join('\n') + '\n', 'utf8');
  return entries;
}
function similar(title, entries, pattern) {
  const wanted = String(title).trim().toLowerCase();
  return entries.filter(e => e.name.toLowerCase() === wanted ||
    (pattern && e.fm.pattern && String(pattern).toLowerCase() === String(e.fm.pattern).toLowerCase()));
}
module.exports = { readFm, setFm, list, matches, words, buildIndex, similar };
