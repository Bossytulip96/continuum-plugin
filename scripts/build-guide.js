'use strict';
// Builds "Continuum Guide for Codex.html" from GUIDE-CODEX.md and "Continuum Guide for Claude.html" from
// GUIDE-CLAUDE.md, each from its own source, so the guide opens in the browser with a
// double-click (Windows asks which app opens a .md file, and Notepad may show an "untrusted source" box).
// Only the markdown the guide uses: # and ## headings, paragraphs, 1. and - lists, a - list nested under a
// numbered item (3 spaces in), indented continuation lines, **bold**, `code`, --- and <!-- comments --> (dropped).
// No dependencies.
// Run: node scripts/build-guide.js (from anywhere). The output is the same bytes for the same guide.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'GUIDE-CODEX.md');
const TARGET = path.join(ROOT, 'Continuum Guide for Codex.html');
const TITLE = 'Continuum for Codex: setup guide';
// Every guide this script builds. SOURCE, TARGET and TITLE above are the Codex one, kept for the tests.
const GUIDES = [{ source: SOURCE, target: TARGET, title: TITLE },
  { source: path.join(ROOT, 'GUIDE-CLAUDE.md'), target: path.join(ROOT, 'Continuum Guide for Claude.html'), title: 'Continuum for the Claude app: setup guide' }];
const STYLE = [
  ':root{--bg:#fdfdfb;--fg:#1d1d1f;--muted:#5a5a60;--rule:#d9d9de;--code:#eeeef2}',
  '@media (prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#ececf0;--muted:#a3a3ad;--rule:#3a3a42;--code:#2a2a31}}',
  'html{-webkit-text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  'main{max-width:46em;margin:0 auto;padding:1.5em 16px 3em;overflow-wrap:break-word}',
  'h1{font-size:1.7em;line-height:1.25;margin:0.4em 0 0.6em}',
  'h2{font-size:1.3em;line-height:1.3;margin:1.8em 0 0.5em}',
  'p,ol,ul{margin:0 0 1em}',
  'ol,ul{padding-left:1.6em}',
  'li{margin:0.35em 0}',
  'li ul{margin:0.35em 0 0}',
  'hr{border:0;border-top:1px solid var(--rule);margin:2em 0}',
  'code{background:var(--code);border-radius:4px;padding:0.1em 0.3em;font-size:0.95em}'
].join('\n');

const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Code spans first (nothing inside them is touched), then **bold** in the text around them.
const inline = text => text.split(/(`[^`]+`)/).map(part => /^`[^`]+`$/.test(part)
  ? '<code>' + escape(part.slice(1, -1)) + '</code>'
  : escape(part).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')).join('');

function blocks(markdown) {
  const out = [];
  let open = null; // the paragraph or list being filled; a blank line closes it
  const close = () => { if (open) out.push(open); open = null; };
  // An HTML comment (lines from <!-- to -->) is a note for whoever edits the source; it never reaches the page.
  const text = markdown.replace(/\r\n?/g, '\n').replace(/^<!--[\s\S]*?-->[^\n]*(\n|$)/gm, '');
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line) close();
    else if (/^---$/.test(line)) { close(); out.push({ kind: 'hr' }); }
    else if ((m = line.match(/^(#{1,2}) (.*)$/))) { close(); out.push({ kind: 'h' + m[1].length, text: m[2] }); }
    else if ((m = line.match(/^(\d+)\. (.*)$/)) || (m = line.match(/^()- (.*)$/))) {
      const kind = m[1] ? 'ol' : 'ul';
      if (!open || open.kind !== kind) { close(); open = { kind, start: Number(m[1]) || 1, items: [] }; }
      open.items.push({ text: m[2], sub: [] });
    } else if (open && open.kind === 'ol' && (m = line.match(/^ {3}- (.*)$/))) open.items[open.items.length - 1].sub.push(m[1]);
    else if (open && open.kind !== 'p' && /^ /.test(line)) {
      const item = open.items[open.items.length - 1];
      if (item.sub.length) item.sub[item.sub.length - 1] += ' ' + line.trim(); else item.text += ' ' + line.trim();
    } else if (open && open.kind === 'p') open.lines.push(line.trim());
    else { close(); open = { kind: 'p', lines: [line.trim()] }; }
  }
  close();
  return out;
}

function render(markdown, title = TITLE) {
  const body = blocks(markdown).map(b => {
    if (b.kind === 'hr') return '<hr>';
    if (b.kind === 'h1' || b.kind === 'h2') return '<' + b.kind + '>' + inline(b.text) + '</' + b.kind + '>';
    if (b.kind === 'p') return '<p>' + inline(b.lines.join(' ')) + '</p>';
    const items = b.items.map(i => '<li>' + inline(i.text) +
      (i.sub.length ? '\n<ul>\n' + i.sub.map(s => '<li>' + inline(s) + '</li>').join('\n') + '\n</ul>\n' : '') + '</li>');
    return '<' + b.kind + (b.kind === 'ol' && b.start !== 1 ? ' start="' + b.start + '"' : '') + '>\n' + items.join('\n') + '\n</' + b.kind + '>';
  });
  return ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">', '<title>' + title + '</title>',
    '<style>', STYLE, '</style>', '</head>', '<body>', '<main>', ...body, '</main>', '</body>', '</html>', ''].join('\n');
}

if (require.main === module) {
  // The zip carries only the HTML (the GUIDE-*.md sources are export-ignore), so a source can be missing there.
  for (const g of GUIDES) {
    if (!fs.existsSync(g.source)) {
      console.error('Cannot build the guide: ' + g.source + ' is not here (the zip carries only the HTML guide; build from the repository).');
      process.exitCode = 1;
    } else {
      fs.writeFileSync(g.target, render(fs.readFileSync(g.source, 'utf8'), g.title), 'utf8');
      console.log('Wrote ' + g.target);
    }
  }
}
module.exports = { render, SOURCE, TARGET, TITLE, GUIDES };
