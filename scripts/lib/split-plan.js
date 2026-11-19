'use strict';
// The read-only half of scripts/split-note.js: parse the note, check the plan and the paths, and work out every
// byte a split would write. Nothing here writes. The proof that the written files are exactly this is here too.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');
const V = require('./vault');
const F = require('./filing');

const SENTENCE = 'A new entry goes into the note for its subject, not into this main note.';
const SECTION = '## Subject notes';
const bare = line => line.replace(/\r?\n$/, '');
const blank = line => bare(line).trim() === '';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function split(text) { return text.match(/[^\n]*\n|[^\n]+$/g) || []; }
function bodyStart(ls) {
  if (!ls.length || bare(ls[0]).replace(/^﻿/, '') !== '---') return 0;
  for (let i = 1; i < ls.length; i++) if (bare(ls[i]) === '---') return i + 1;
  return 0;
}
// Headings and top-level list entries, never inside the frontmatter or a code fence (filing.js has the fence rules).
function starts(ls) {
  const from = bodyStart(ls);
  const inside = F.fences(ls.slice(from)).inside;
  const out = [];
  for (let i = from; i < ls.length; i++) {
    if (inside[i - from]) continue;
    const b = bare(ls[i]);
    const h = b.match(/^(#{1,6})(?:[ \t]|$)/);
    if (h) out.push({ i, heading: h[1].length });
    else if (/^[-*+][ \t]/.test(b)) out.push({ i, heading: 0 });
  }
  return out;
}
// A ## to ###### section runs to the next heading of its level or higher; an entry runs to the next entry or heading.
function blockEnd(ls, all, s) {
  const next = all.find(o => o.i > s.i && (s.heading ? o.heading && o.heading <= s.heading : true));
  return next ? next.i : ls.length;
}
function resolve(ls, name) {
  const all = starts(ls);
  const want = String(name).replace(/\r?\n$/, '').trimEnd();
  const hits = all.filter(s => s.heading !== 1 && bare(ls[s.i]).trimEnd() === want);
  if (hits.length !== 1) return { error: hits.length ? 'found ' + hits.length + ' times (lines ' + hits.map(h => h.i + 1).join(', ') + ')' : 'not found' };
  return { from: hits[0].i, to: blockEnd(ls, all, hits[0]) };
}
const counts = text => split(text).filter(l => !blank(l)).reduce((m, l) => m.set(bare(l), (m.get(bare(l)) || 0) + 1), new Map());
// The original's non-blank lines against the pieces' lines, each piece counted on its own, as multisets.
function sameLines(a, pieces) {
  const x = counts(a); const y = counts(pieces.map(t => t.endsWith('\n') || t === '' ? t : t + '\n').join(''));
  if (x.size !== y.size) return false;
  for (const [k, n] of x) if (y.get(k) !== n) return false;
  return true;
}
// A title becomes a file name: no path separators, no "..", no drive letter, nothing Windows forbids, no reserved name.
function badTitle(title) {
  return !title || title.length > 120 || /[<>:"/\\|?*\x00-\x1f[\]#^]/.test(title) || title.includes('..') || /^\.|[. ]$/.test(title) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title);
}
const isLink = file => { try { return fs.lstatSync(file).isSymbolicLink(); } catch (_) { return false; } };
const real = file => { try { return fs.realpathSync(file).toLowerCase(); } catch (_) { return null; } };
const q = value => /^[\w-]+$/.test(value) ? value : JSON.stringify(value);
const slug = title => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'subject';
const plain = message => Object.assign(new Error(message), { plain: true });

function prepare(c, plan) {
  const problems = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw plain('The plan must be a JSON object with "source" and "notes", so nothing was changed.');
  const other = v => { const p = path.resolve(C.normalize(v)); return !(C.inside(c.vault, p) && C.inside(p, c.vault)); };
  if (plan.vault !== undefined && other(plan.vault)) throw plain('The plan names another vault (' + plan.vault + '); only the configured vault ' + c.vault + ' can be split, so nothing was changed.');
  const rel = String(plan.source || '').replace(/\\/g, '/');
  if (!/\.md$/i.test(rel) || rel.split('/').some(p => p.startsWith('.') || /:/.test(p)) || path.isAbsolute(rel)) {
    throw plain('The source must be a note (.md) given by its path inside the vault, so nothing was changed.');
  }
  let file;
  try { file = C.vaultPath(c, rel); } catch (e) { throw plain('The source ' + rel + ' resolves outside the vault (' + e.message + '), so nothing was changed.'); }
  if (isLink(file)) throw plain('The source ' + rel + ' is a link, so nothing was changed.');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw plain('The source note ' + rel + ' does not exist in the vault ' + c.vault + ', so nothing was changed.');
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw plain('The source note ' + rel + ' is not plain UTF-8 text, so it cannot be moved exactly; nothing was changed.');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const ls = split(text);
  const off = [0];
  for (const l of ls) off.push(off[off.length - 1] + l.length);
  const sourceName = path.basename(file, path.extname(file));
  const dir = path.posix.dirname(rel);
  const others = V.list(c).filter(e => path.resolve(e.file) !== path.resolve(file));
  const notes = Array.isArray(plan.notes) ? plan.notes : [];
  if (!notes.length) problems.push('The plan has no subject notes ("notes" is empty).');
  const ranges = [];
  const targets = [];
  const titles = new Set();
  const date = C.date(c);
  for (const n of notes) {
    const title = typeof n.title === 'string' ? n.title.trim() : '';
    if (badTitle(title)) { problems.push('Subject note title "' + (n.title || '') + '" cannot be a file name (no path, "..", drive letter or forbidden character).'); continue; }
    if (titles.has(title.toLowerCase()) || title.toLowerCase() === sourceName.toLowerCase()) { problems.push('Subject note title "' + title + '" is used twice or is the source note itself.'); continue; }
    titles.add(title.toLowerCase());
    for (const field of ['about', 'when_to_use']) if (typeof n[field] !== 'string' || !n[field].trim()) problems.push('Subject note "' + title + '" needs ' + field + '.');
    if (!Array.isArray(n.blocks) || !n.blocks.length) problems.push('Subject note "' + title + '" has no blocks.');
    const t = { title, about: String(n.about || '').trim(), when: String(n.when_to_use || '').trim(), blocks: [], before: null };
    const same = others.filter(e => e.name.toLowerCase() === title.toLowerCase());
    if (same.length > 1) problems.push('More than one note is titled "' + title + '": ' + same.map(e => e.rel).join(', ') + '.');
    t.rel = same.length === 1 ? same[0].rel : (dir === '.' ? '' : dir + '/') + title + '.md';
    try { t.file = C.vaultPath(c, t.rel); } catch (e) { problems.push('Subject note ' + t.rel + ' resolves outside the vault (' + e.message + ').'); continue; }
    if (isLink(t.file)) problems.push('Subject note ' + t.rel + ' is a link; a split never writes through a link.');
    else if (real(t.file) && real(t.file) === real(file)) problems.push('Subject note ' + t.rel + ' is the source note itself.');
    else if (same.length === 1) {
      t.before = fs.readFileSync(t.file);
      // The same round trip the source gets: a note that is not plain UTF-8 is never decoded and rewritten.
      if (!Buffer.from(t.before.toString('utf8'), 'utf8').equals(t.before)) problems.push('Subject note ' + t.rel + ' is not plain UTF-8 text, so entries cannot be added to it exactly; nothing was changed.');
    }
    else {
      if (fs.existsSync(t.file)) problems.push(t.rel + ' already exists and is not a note that can take entries.');
      t.pattern = typeof n.pattern === 'string' && n.pattern.trim() ? n.pattern.trim() : slug(title);
      const clash = others.filter(e => e.fm.pattern && String(e.fm.pattern).toLowerCase() === t.pattern.toLowerCase());
      if (clash.length) problems.push('Pattern "' + t.pattern + '" for "' + title + '" is already used by ' + clash.map(e => e.rel).join(', ') + '.');
    }
    for (const name of Array.isArray(n.blocks) ? n.blocks : []) {
      const r = resolve(ls, name);
      if (r.error) { problems.push('Block "' + name + '": ' + r.error + ' in ' + rel + '.'); continue; }
      // The exact byte range of the source; a block that ends the file without a line break gets the tool's own separator.
      const b = { ...r, name, start: off[r.from], end: off[r.to] };
      b.text = text.slice(b.start, b.end);
      b.sep = b.text.endsWith('\n') ? '' : eol;
      ranges.push({ ...b, target: t });
      t.blocks.push(b);
    }
    targets.push(t);
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) problems.push('Block "' + ranges[i].name + '" lies inside or overlaps block "' + ranges[i - 1].name + '"; name each entry once.');
  }
  const fm = V.readFm(text) || {};
  for (const t of targets) {
    t.blocks.sort((a, b) => a.start - b.start);
    t.moved = t.blocks.map(b => b.text + b.sep).join('');
    if (t.before) {
      const prev = t.before.toString('utf8');
      t.header = (prev === '' || prev.endsWith('\n') ? '' : eol) + eol + '## Moved from [[' + sourceName + ']] on ' + date + ' (word for word)' + eol + eol;
      t.final = prev + t.header + t.moved;
    } else {
      t.header = ['---', 'type: ' + q(String(fm.type || 'reference')), 'pattern: ' + q(t.pattern || slug(t.title)), 'about: ' + JSON.stringify(t.about),
        'when_to_use: ' + JSON.stringify(t.when), 'trust: ask', 'status: active', 'superseded_by: ""', 'last_used: ""', 'times_used: 0', '---', '',
        '# ' + t.title, '', 'Made ' + date + '. The entries below were moved word for word from [[' + sourceName + ']].', '', ''].join(eol);
      t.final = t.header + t.moved;
    }
  }
  // The main note: every line not moved, then the Subject notes section, found or placed with the same parser.
  const moved = new Set(ranges.flatMap(r => Array.from({ length: r.to - r.from }, (_, k) => r.from + k)));
  const rest = ls.filter((_, i) => !moved.has(i)).join('');
  const restLines = split(rest);
  const all = starts(restLines);
  const found = all.find(s => s.heading === 2 && bare(restLines[s.i]).trimEnd() === SECTION);
  const links = section => targets.filter(t => !section.includes('[[' + t.title + ']]')).map(t => '- [[' + t.title + ']]: ' + t.about + eol).join('');
  let pos; let insert;
  if (found) {
    const end = blockEnd(restLines, all, found);
    const section = restLines.slice(found.i, end).join('');
    pos = restLines.slice(0, end).join('').length;
    insert = (pos && !rest.slice(0, pos).endsWith('\n') ? eol : '') + (section.includes(SENTENCE) ? '' : SENTENCE + eol) + links(section);
    if (insert && end < restLines.length) insert += eol;
  } else {
    pos = rest.length;
    insert = (rest === '' || rest.endsWith('\n') ? '' : eol) + eol + SECTION + eol + eol + SENTENCE + eol + eol + links('');
  }
  const main = rest.slice(0, pos) + insert + rest.slice(pos);
  return { rel, file, text, bytes, eol, targets, problems, main, pos, insert, sourceName, ranges };
}
// The proof, on the files as read back from disk. Throws a plain reason on the first difference.
function prove(p, read) {
  for (const t of p.targets) {
    const disk = read(t.file);
    if (disk !== t.final) throw new Error(t.rel + ' does not hold exactly what was written');
    const moved = disk.slice(disk.length - t.moved.length);
    let at = 0;
    for (const b of t.blocks) { // each block: the exact source range, in source order, then only the tool's own separator
      if (b.text !== p.text.slice(b.start, b.end) || moved.slice(at, at + b.text.length) !== b.text) throw new Error('a block is not whole in ' + t.rel);
      at += b.text.length;
      if (moved.slice(at, at + b.sep.length) !== b.sep) throw new Error('a separator in ' + t.rel + ' is not the tool\'s own');
      at += b.sep.length;
      const twins = t.blocks.filter(o => o.text === b.text).length;
      if (moved.split(b.text).length - 1 < twins) throw new Error('a block is not found in ' + t.rel);
    }
    if (at !== moved.length) throw new Error(t.rel + ' holds text that is not a moved block');
  }
  // The main note, built a second way: the old text with exactly the moved byte ranges cut out, plus the section.
  let cut = ''; let from = 0;
  for (const r of p.ranges) { cut += p.text.slice(from, r.start); from = r.end; }
  cut += p.text.slice(from);
  const main = read(p.file);
  if (main !== cut.slice(0, p.pos) + p.insert + cut.slice(p.pos)) throw new Error(p.rel + ' is not the old note minus the moved entries plus the Subject notes list');
  // Second, independent proof: every non-blank line of the old note, as often as before.
  if (!sameLines(p.text, [cut, ...p.targets.map(t => t.moved)])) throw new Error('the line check found a line missing or doubled');
}
module.exports = { prepare, prove, resolve, starts, sameLines, badTitle, sha, SECTION, SENTENCE };
