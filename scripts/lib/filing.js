'use strict';
// Filing: no note is ever cut silently, and a note that has grown too large is raised with the person
// so it can be split into a short main note with subject notes (scripts/split-note.js), word for word.
const fs = require('fs');
const path = require('path');
const C = require('./config');
const V = require('./vault');

// The split command as the assistant should run it on this host (the host flag picks the config file).
function command(mode = '--dry-run <plan.json>') {
  return 'node "' + C.pluginPath('scripts', 'split-note.js') + '"' +
    (C.host.name() === 'claude' ? '' : ' --host ' + C.host.name()) + ' ' + mode;
}
function notice(total, kept, rel) {
  return '[continuum] This note is ' + total + ' characters and only the first ' + kept + ' were loaded. ' +
    'The rest is in the file ' + rel + '. Read the whole file yourself before relying on it. ' +
    'Tell the person this note has grown too large and offer to split it into a main note with subject notes: ' +
    'dry run first with ' + command() + ', then the real split only after their yes. ' +
    'Never shorten or summarize a note to make it fit.';
}
// Code fences, CommonMark style: an opener is 3 or more backticks or tildes (a backtick opener's info string has no
// backtick); only the same character, at least as many, with nothing after, closes it. inside[i]: fence line or within.
function fences(lines) {
  const inside = [];
  let open = null;
  for (const line of lines) {
    const b = String(line).replace(/\r?\n$/, '').replace(/\r$/, '');
    if (open) {
      inside.push(true);
      const m = b.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (m && m[1][0] === open.ch && m[1].length >= open.n) open = null;
      continue;
    }
    const m = b.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) { open = { ch: m[1][0], n: m[1].length }; inside.push(true); continue; }
    inside.push(false);
  }
  return { inside, open };
}
// The one place loaded text is held to the load limit: unchanged when it fits; otherwise cut at the last line
// break before the limit (or, with none, never inside a surrogate pair or before a character's combining marks),
// a code fence left open is closed, and a plain notice on its own lines says what is missing and where it is.
function fit(text, limit, rel) {
  text = String(text);
  if (text.length <= limit) return text;
  let at = text.lastIndexOf('\n', limit);
  if (at <= 0) {
    at = limit;
    const low = i => /[\uDC00-\uDFFF]/.test(text[i] || '');
    if (low(at)) at--;
    while (at > 0 && /^\p{M}/u.test(text.slice(at, at + 2))) { at--; if (low(at)) at--; }
  }
  const kept = text.slice(0, at).replace(/\r$/, '');
  const open = fences(kept.split('\n')).open;
  return kept + (open ? '\n' + open.ch.repeat(open.n) : '') + '\n\n' + notice(text.length, kept.length, rel);
}
// The Working Agreements as session start loads them: the numbered standing rules, or else the whole note
// without its frontmatter.
function agreements(text) {
  if (text === null || text === undefined) return { rules: [], whole: null };
  const section = text.match(/^## Standing rules\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  const rules = section ? section[1].split(/\r?\n/).filter(line => /^\d+\.\s/.test(line)) : [];
  return { rules, whole: text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim() };
}
// Notes a session can load whole: the start page, the Working Agreements, and every Knowledge note routing can pick.
function routable(e) {
  return Boolean(V.readFm(e.text)) && V.words(e.fm.when_to_use).length > 0 && !/^(parked|superseded)$/i.test(e.fm.status || '');
}
function sizes(c, entries = V.list(c)) {
  const limit = c.inject.maxNoteChars;
  const start = C.vaultPath(c, c.inject.startPage);
  const rows = [];
  for (const e of entries) {
    const wa = e.rel === 'Knowledge/Working Agreements.md';
    if (!(e.file === start || wa || (e.rel.startsWith('Knowledge/') && routable(e)))) continue;
    // The same text the loader emits: for the rules note, its numbered standing rules as session start joins them,
    // or the whole note without frontmatter when it has none.
    const a = wa ? agreements(e.text) : null;
    const chars = a ? (a.rules.length ? a.rules.join('\n\n').length : a.whole.length) : e.text.length;
    if (chars < limit * 0.8) continue;
    rows.push({ rel: e.rel, name: e.name, chars, pct: Math.round(chars * 100 / limit), state: chars > limit ? 'over' : 'close' });
  }
  return rows.sort((a, b) => b.chars - a.chars || a.rel.localeCompare(b.rel));
}
// The status section, one line each; "none" when clean.
function report(c, rows = sizes(c)) {
  const head = 'note sizes (load limit ' + c.inject.maxNoteChars + ' characters): ';
  const lines = !rows.length ? [head + 'none over the limit or close to it']
    : [head + rows.filter(r => r.state === 'over').length + ' over, ' + rows.filter(r => r.state === 'close').length + ' close'].concat(
      rows.map(r => (r.state === 'over' ? 'over the limit: ' : 'close to the limit: ') + r.rel + ', ' + r.chars + ' characters (' + r.pct + '%)'));
  const codex = codexStart(c);
  if (codex) lines.push('codex start text: ' + codex.chars + ' characters, Codex loads only the first ' + codex.limit + ' (largest part: ' + codex.rel + ')');
  return lines;
}
// The session-start line, only when a loadable note is over the limit.
function startLine(c, rows) {
  const over = rows.filter(r => r.state === 'over');
  if (!over.length) return null;
  return '[continuum] Notes too large to load whole: ' + over.slice(0, 3).map(r => r.rel + ' (' + r.chars + ' characters)').join(', ') +
    (over.length > 3 ? ' and ' + (over.length - 3) + ' more' : '') + '; the load limit is ' + c.inject.maxNoteChars +
    '. Tell the person and offer to split each into a short main note with subject notes, moved word for word: run ' +
    command() + ' first and show the numbers, and run it without --dry-run only after their yes. Never shorten or summarize a note to make it fit.';
}
// One split proposal per close-or-over note (and, on Codex, for the larger part of an over-budget start text);
// the proposal store refuses a second open one for the same note.
function propose(c, P, rows = sizes(c)) {
  const wanted = rows.map(r => ({ rel: r.rel, name: r.name, evidence: r.chars + ' characters, ' + r.pct + '% of the load limit of ' +
    c.inject.maxNoteChars + (r.state === 'over' ? ' (over: only the start loads)' : '') }));
  const codex = codexStart(c);
  if (codex && !wanted.some(w => w.rel === codex.rel)) {
    wanted.push({ rel: codex.rel, name: path.basename(codex.rel, '.md'), evidence: 'Codex start text ' + codex.chars + ' characters; Codex loads only the first ' + codex.limit });
  }
  const made = [];
  for (const w of wanted) {
    const row = P.add(c, { kind: 'split', subject: w.rel, evidence: w.evidence, situation: w.name,
      proposal: 'Split this note into a short main note with subject notes, moved word for word (dry run first, then the person\'s yes)' });
    if (row) made.push(row);
  }
  return made;
}
// Shell text -> commands -> words, with quotes taken off, comments dropped, and ; && || | & and line breaks between commands.
function commands(text) {
  const out = [];
  let words = []; let word = null; let quote = null;
  const push = () => { if (word !== null) { words.push(word); word = null; } };
  const end = () => { push(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = null; else word += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; word = word === null ? '' : word; continue; }
    // A line continuation (bash \, PowerShell `, cmd ^ right before a line break) joins the next line to this command.
    if (/[\\`^]/.test(ch) && /^\r?\n/.test(text.slice(i + 1, i + 3))) { push(); i += text[i + 1] === '\r' ? 2 : 1; continue; }
    if (ch === '#' && word === null) { while (i + 1 < text.length && text[i + 1] !== '\n') i++; continue; }
    if (/[;&|\r\n]/.test(ch)) { end(); continue; }
    if (/\s/.test(ch)) { push(); continue; }
    word = (word === null ? '' : word) + ch;
  }
  end();
  return out;
}
// The gate: a run of split-note.js is a dry run only when --dry-run is an argument of that same command. A bare run
// (usage) and --help change nothing. Everything else rewrites notes.
// A command handed to another shell as one quoted string (bash -c "...", powershell -Command "...") is read the same way.
function realSplit(text) {
  return commands(String(text)).some(words => words.some(w => /\s/.test(w) && /split-note\.js/i.test(w) && realSplit(w)) || direct(words));
}
function direct(words) {
  {
    const k = words.findIndex(w => /(?:^|[\\/])split-note\.js$/i.test(w));
    if (k < 0) return false;
    const args = [];
    for (let i = k + 1; i < words.length; i++) {
      if (/^--host$/i.test(words[i])) { i++; continue; }
      if (!/^--host=/i.test(words[i])) args.push(words[i]);
    }
    if (args.includes('--dry-run')) return false;
    return !(args.length === 0 || (args.length === 1 && /^(?:--help|-h)$/.test(args[0])));
  }
}
// The lock, the journal and the attention list live in split-state.js; these are the lines status and session start show.
const unfinishedLines = c => require('./split-state').lines(c);
// Codex keeps only the first additionalContextLimit characters of the start text: the one Continuum installed for
// this vault (project hooks file, then the user one), else the template's value.
function codexLimit(c) {
  const S = require('./codex-setup');
  for (const file of [S.projectFile(c.vault), S.userFile()]) {
    try {
      const groups = (S.readHooks(file).hooks || {}).SessionStart || [];
      for (const h of groups.flatMap(g => g.hooks || [])) if (S.ours(h) && Number.isSafeInteger(h.additionalContextLimit)) return h.additionalContextLimit;
    } catch (_) { /* missing or unreadable: try the next */ }
  }
  try {
    const t = JSON.parse(fs.readFileSync(C.pluginPath('hooks', 'codex-hooks.json'), 'utf8'));
    return t.hooks.SessionStart[0].hooks[0].additionalContextLimit || 10000;
  } catch (_) { return 10000; }
}
function codexLine(c, length) {
  const limit = codexLimit(c);
  const make = n => '[continuum] This start text is ' + n + ' characters and Codex loads only the first ' + limit + ', so the end is missing. ' +
    'Read START HERE.md and Knowledge/Working Agreements.md from the notes folder yourself before answering. Tell the person the ' +
    'start page or the rules have grown too large for Codex and offer to split them: ' + command() + ' first, the real split only after their yes.';
  if (length <= limit) return null;
  let line = make(length);
  for (let i = 0; i < 2; i++) line = make(length + line.length + 2);
  return line;
}
// On Codex only: the start text Continuum would emit, measured, with the larger of the start page and the rules.
function codexStart(c) {
  if (!C.host.isCodex()) return null;
  const text = require('../session-start').build(c).join('\n\n');
  const limit = codexLimit(c);
  const line = codexLine(c, text.length);
  if (!line) return null;
  const size = rel => { try { return fs.readFileSync(C.vaultPath(c, rel), 'utf8').length; } catch (_) { return 0; } };
  const rel = size(c.inject.startPage) >= size('Knowledge/Working Agreements.md') ? c.inject.startPage : 'Knowledge/Working Agreements.md';
  return { chars: text.length + line.length + 2, limit, rel };
}
module.exports = { command, notice, fences, fit, agreements, sizes, report, startLine, propose, commands, realSplit, routable,
  unfinishedLines, codexLimit, codexLine, codexStart };
