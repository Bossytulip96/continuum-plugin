#!/usr/bin/env node
'use strict';
const fs = require('fs');
const config = require('./lib/config');
const vault = require('./lib/vault');
const proposals = require('./proposal');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
function status(c) {
  const notes = vault.list(c);
  const skills = notes.filter(n => n.fm && (n.fm.type === 'skill' || n.rel.startsWith('Knowledge/Skills/')) && n.name !== 'README');
  const sessions = notes.filter(n => n.fm && n.fm.type === 'session')
    .sort((a, b) => String(b.fm.updated || '').localeCompare(String(a.fm.updated || '')));
  const approvals = readJson(config.configFile(c, 'approvals.json'));
  const entries = Object.entries(approvals);
  const active = entries.filter(([level, row]) => {
    if (!['vendor-write', 'email-send', 'vault-delete', 'system-change', 'new-note'].includes(level) ||
      !row || typeof row !== 'object') return false;
    const now = Date.now();
    return Number.isFinite(row.issued) && Number.isFinite(row.expires) && row.issued <= now &&
      now - row.issued < config.ttl(c) && row.expires > now && row.expires <= row.issued + config.ttl(c) &&
      typeof row.note === 'string' && row.note.trim().length > 0;
  });
  console.log([
    'Config: ' + c.configPath,
    'Vault: ' + c.vault,
    'Notes: ' + notes.length,
    'Skills: ' + skills.length,
    'Pending proposals: ' + proposals.load(c).filter(proposals.open).length,
    'Last digest: ' + (sessions.length ? sessions[0].rel + ' (' + sessions[0].fm.updated + ')' : 'none'),
    'Approvals in force: ' + active.length + (active.length ? ' (' + active.map(([level]) => level).join(', ') + ')' : '')
  ].join('\n'));
}
function readActions(c, month) {
  const log = config.vaultPath(c, 'Log');
  let names;
  try { names = fs.readdirSync(log); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const rows = [];
  for (const name of names.filter(name => name.startsWith('decisions-') && name.endsWith('-' + month + '.md'))) {
    const text = fs.readFileSync(config.vaultPath(c, 'Log', name), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const parts = line.split(' | ');
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(parts[0]) || parts[0].slice(0, 7) !== month) continue;
      const action = (parts[1] || '').match(/^action:\s*(.+)$/i);
      // The gate logs its lines under the tool's name (Bash, Write, a connector), which is
      // not a repeatable task; found on the outside tester's machine as "a skill for Bash".
      if (action && !/^(?:approval|bash|powershell|write|edit|read|grep|glob|mcp__.*)$/i.test(action[1].trim())) {
        rows.push({ action: action[1].trim(), date: parts[0].slice(0, 10) });
      }
    }
  }
  return rows;
}
const normal = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function hasSkill(action, notes) {
  return notes.some(note => {
    const fm = note.fm || {};
    if (fm.type !== 'skill' && !note.rel.startsWith('Knowledge/Skills/')) return false;
    if (note.name === 'README') return false;
    return normal(note.name) === normal(action) || (fm.pattern && normal(fm.pattern) === normal(action)) ||
      vault.matches(fm.when_to_use || '', action) > 0 || vault.matches(note.name, action) > 0;
  });
}
function consolidate(c, mode) {
  const notes = vault.list(c);
  const today = config.date(c);
  const rows = readActions(c, today.slice(0, 7));
  const groups = new Map();
  for (const row of rows) {
    const id = normal(row.action);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  const repeated = [...groups.values()].filter(group => group.length >= 3)
    .sort((a, b) => b.length - a.length || a[0].action.localeCompare(b[0].action));
  const made = [];
  for (const group of repeated) {
    const action = group[0].action;
    if (hasSkill(action, notes)) continue;
    const row = proposals.add(c, {
      kind: 'skill', subject: action, proposal: 'Draft a skill note for this repeated action for the person to review.',
      evidence: group.length + ' recorded actions in ' + today.slice(0, 7) + '; no matching skill note.',
      situation: action
    });
    if (row) made.push(row);
  }
  const pending = proposals.load(c).filter(proposals.open);
  const stale = pending.filter(row => (Date.parse(today + 'T00:00:00Z') - Date.parse(row.date + 'T00:00:00Z')) / 86400000 > 7);
  const index = vault.buildIndex(c);
  const home = config.vaultPath(c, 'Home.md');
  const summary = mode + ': index ' + index.length + ' notes; ' + stale.length + ' unanswered proposals older than 7 days; ' +
    repeated.length + ' repeated actions; ' + made.length + ' new proposals.';
  if (!fs.existsSync(home)) fs.writeFileSync(home, '# Home\n', 'utf8');
  fs.appendFileSync(home, '\n- ' + config.stamp(c) + ': ' + summary + '\n', 'utf8');
  console.log(summary);
  console.log('Unanswered proposals older than 7 days:');
  console.log(stale.length ? stale.map(row => '- ' + proposals.line(row) + ' [since ' + row.date + ']').join('\n') : '- none');
  console.log('Repeated actions this month:');
  console.log(repeated.length ? repeated.map(group => '- ' + group[0].action + ': ' + group.length +
    (hasSkill(group[0].action, notes) ? ' (skill note exists)' : ' (proposal pending or filed)')).join('\n') : '- none');
}
module.exports = { status, consolidate, readActions, hasSkill };
if (require.main === module) config.runCli(() => {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--status', '--nightly', '--weekly'].includes(args[0])) {
    throw new Error('usage: consolidate.js --status|--nightly|--weekly');
  }
  const c = config.load();
  if (args[0] === '--status') status(c);
  else consolidate(c, args[0].slice(2));
});
