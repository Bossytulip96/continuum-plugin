#!/usr/bin/env node
'use strict';
const fs = require('fs');
const config = require('./lib/config');
const decisions = require('./decision-log');
const columns = ['id', 'date', 'kind', 'subject', 'proposal', 'evidence', 'situation', 'status', 'decided'];
const header = '| ' + columns.join(' | ') + ' |';
const divider = '|' + columns.map(() => '---').join('|') + '|';
const clean = value => String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
const store = c => config.vaultPath(c, 'Log', 'proposals.md');
const open = row => row.status === 'pending' || row.status === 'later';

function read(c) {
  try { return fs.readFileSync(store(c), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}
function load(c) {
  return read(c).split(/\r?\n/).filter(raw => /^\|\s*p\d+\s*\|/.test(raw)).map(raw => {
    const cells = raw.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length !== columns.length || !/^\d{4}-\d{2}-\d{2}$/.test(cells[1])) {
      throw new Error('Invalid proposal table row; preserve it and repair it before writing.');
    }
    return Object.fromEntries(columns.map((name, i) => [name, cells[i]]));
  });
}
function save(c, rows) {
  const before = read(c);
  const lines = before.split(/\r?\n/);
  const start = lines.findIndex(raw => /^\|\s*id\s*\|/i.test(raw));
  let prefix, suffix = '';
  if (start < 0) prefix = before.trimEnd() + (before.trim() ? '\n\n' : '# Proposals\n\n') + header + '\n' + divider + '\n';
  else {
    const actual = lines[start].split('|').slice(1, -1).map(s => s.trim().toLowerCase());
    if (actual.join(',') !== columns.join(',')) throw new Error('Proposal table columns conflict; no table changes made.');
    let end = start + 1;
    while (end < lines.length && /^\|/.test(lines[end])) end++;
    prefix = lines.slice(0, start).join('\n') + (start ? '\n' : '') + header + '\n' + divider + '\n';
    suffix = lines.slice(end).join('\n');
  }
  const body = rows.map(row => '| ' + columns.map(name => clean(row[name])).join(' | ') + ' |').join('\n');
  fs.mkdirSync(config.vaultPath(c, 'Log'), { recursive: true });
  fs.writeFileSync(store(c), prefix + body + '\n' + suffix, 'utf8');
}
function add(c, input) {
  const p = Object.fromEntries(['kind', 'subject', 'proposal', 'evidence', 'situation'].map(name => [name, clean(input[name])]));
  if (!p.kind || !p.subject || !p.proposal) throw new Error('kind, subject, and proposal are required');
  const rows = load(c);
  const today = config.date(c);
  const days = date => (Date.parse(today + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000;
  const same = rows.filter(row => row.kind.toLowerCase() === p.kind.toLowerCase() && row.subject.toLowerCase() === p.subject.toLowerCase());
  if (same.some(row => open(row) || days(row.date) < 14 || (row.decided && days(row.decided.slice(0, 10)) < 14))) return null;
  const n = rows.reduce((max, row) => Math.max(max, Number(row.id.slice(1))), 0) + 1;
  const row = { id: 'p' + n, date: today, ...p, situation: p.situation || p.subject, status: 'pending', decided: '' };
  rows.push(row);
  save(c, rows);
  return row;
}
function answer(c, id, value, words) {
  if (!['yes', 'no', 'later'].includes(value)) throw new Error('answer must be yes, no, or later');
  if (!clean(words)) throw new Error("Record the person's actual words with the answer.");
  const rows = load(c);
  const row = rows.find(item => item.id === id);
  if (!row) throw new Error('No proposal ' + id);
  row.status = { yes: 'accepted', no: 'parked', later: 'later' }[value];
  row.decided = config.stamp(c) + ' ' + value + ': ' + clean(words);
  save(c, rows);
  decisions.append(c, 'proposal: ' + row.subject, row.kind + ' ' + row.id, value, words);
  return row;
}
function line(row) {
  return row.id + ' (' + row.kind + ') ' + row.subject + ': ' + row.proposal + '. Evidence: ' +
    (row.evidence || 'none recorded') + '. Situation: ' + row.situation + (row.status === 'later' ? ' [later: ' + row.decided + ']' : '');
}
module.exports = { load, open, add, answer, line };
if (require.main === module) config.runCli(() => {
  const [cmd = 'list', ...args] = process.argv.slice(2);
  const c = config.load();
  if (cmd === 'list') {
    const rows = load(c).filter(open);
    console.log(rows.length ? rows.map(line).join('\n') : 'nothing pending');
  } else if (cmd === 'add') {
    const [kind, subject, proposal, evidence = '', situation = ''] = args;
    const row = add(c, { kind, subject, proposal, evidence, situation });
    console.log(row ? 'added ' + row.id + ': ' + line(row) : 'not added (same proposal open or recorded within 14 days)');
  } else if (['yes', 'no', 'later'].includes(cmd)) {
    const [id, ...words] = args;
    const row = answer(c, id, cmd, words.join(' '));
    console.log(row.id + ' ' + row.status + ': ' + row.subject);
  } else throw new Error('usage: proposal.js add|list|yes|no|later');
});
