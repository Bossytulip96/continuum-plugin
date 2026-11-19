'use strict';
// Filing: no silent cut, the size check, split proposals, split-note.js and the gate. Every script runs as a
// real child process against a throwaway home folder, config and vault made by setup.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-filing-'));
const home = path.join(temp, 'home');
const vault = path.join(temp, 'vault');
const file = path.join(temp, 'config', 'config.json');
const env = { ...process.env, USERPROFILE: home, HOME: home, CONTINUUM_CONFIG: file, CLAUDE_CONFIG_DIR: path.join(temp, 'claude'),
  CODEX_HOME: path.join(temp, 'codex-home'), CONTINUUM_DESKTOP: path.join(temp, 'desktop') };
delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
let checks = 0;
function run(name, args = [], input, expected = 0) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 20000,
    input: input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input), maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(r.error);
  if (expected !== null) assert.equal(r.status, expected, name + ' ' + args.join(' ') + ': ' + r.stderr + r.stdout);
  return r;
}
function hook(name, extra = {}, host = []) {
  const event = { 'session-start': 'SessionStart', 'prompt-route': 'UserPromptSubmit', 'action-gate': 'PreToolUse' }[name];
  const out = JSON.parse(run(name, host, { session_id: 'filing-1', transcript_path: path.join(temp, 'rollout.jsonl'), cwd: vault, hook_event_name: event, ...extra }).stdout);
  return out;
}
const ctx = out => (out.hookSpecificOutput || {}).additionalContext || '';
const step = (name, fn) => { fn(); checks++; console.log('PASS filing ' + checks + ': ' + name); };
const p = rel => path.join(vault, ...rel.split('/'));
const read = rel => fs.readFileSync(p(rel), 'utf8');
const write = (rel, text) => { fs.mkdirSync(path.dirname(p(rel)), { recursive: true }); fs.writeFileSync(p(rel), text); };
const fm = (terms, pattern) => '---\ntype: reference\npattern: ' + pattern + '\nabout: Fixture\nwhen_to_use: "' + terms + '"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\n';
const filler = (tag, n) => Array.from({ length: n }, (_, i) => tag + ' line ' + i + ': ' + 'words '.repeat(12).trim()).join('\n') + '\n';
const config = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const setLimit = n => { const c = config(); c.inject.maxNoteChars = n; fs.writeFileSync(file, JSON.stringify(c)); };
// Every file in the vault with its bytes, .backups left out unless asked.
function snapshot(withBackups = false) {
  const out = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (withBackups || e.name !== '.backups') walk(f); } else out.set(path.relative(vault, f), fs.readFileSync(f));
    }
  })(vault);
  return out;
}
function same(a, b) {
  assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort());
  for (const [k, v] of a) assert(v.equals(b.get(k)), k + ' changed');
}
// The notice: names the file, says how much loaded; the kept text is a prefix of the file ending at a line break.
function noticed(text, rel, source) {
  const at = text.indexOf('[continuum] This note is ');
  assert(at > 0, 'notice missing for ' + rel);
  const notice = text.slice(at).split('\n')[0];
  assert(notice.includes('The rest is in the file ' + rel + '.') && /Never shorten or summarize/.test(notice) && /--dry-run/.test(notice));
  assert(notice.length < 450 + path.join(root, 'scripts', 'split-note.js').length, 'notice too long: ' + notice.length);
  const m = notice.match(/is (\d+) characters and only the first (\d+) were loaded/);
  assert.equal(Number(m[1]), source.length);
  return Number(m[2]);
}
const plan = (obj, name = 'plan.json') => { const f = path.join(temp, name); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
const split = (args, expected = 0) => run('split-note', args, undefined, expected);
try {
  step('setup makes the vault with the starter skill note and the ninth rule', () => {
    const out = run('setup', ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no']).stdout;
    assert.match(out, /Created 13 template files/);
    assert.match(read('Knowledge/Skills/Split a large note.md'), /when_to_use: "note too large, note too long, split a note/);
    const start = ctx(hook('session-start', { source: 'startup' }));
    assert.match(start, /\n9\. Nothing is trimmed to fit\./);
    assert(!start.includes('[continuum] This note is') && !start.includes('Notes too large'), 'nothing is cut or flagged in a fresh vault');
    assert.match(run('status').stdout, /INFO note sizes \(load limit 25000 characters\): none over the limit or close to it/);
    // From here on the load limit is 5000, far under the real 25000. A short fixed start page keeps the sizes and
    // proposal counts below independent of how long the starter start page is.
    write('START HERE.md', fm('', 'start') + '# START HERE\n\nA short fixed start page for the checks below.\n');
  });
  step('the shared cut: unchanged when it fits; else at the last line break, with the notice; no line break: at the limit', () => {
    const F = require('../scripts/lib/filing');
    assert.equal(F.fit('abc\ndef\n', 8, 'x.md'), 'abc\ndef\n');
    const cut = F.fit('abc\ndefgh\nij', 7, 'x.md');
    assert(cut.startsWith('abc\n\n[continuum] This note is 12 characters and only the first 3 were loaded.'));
    assert(F.fit('abcdefghij', 4, 'x.md').startsWith('abcd\n\n[continuum] This note is 10 characters and only the first 4'));
    // No line break to cut at: never inside a surrogate pair, never between a character and its combining marks.
    assert(F.fit('aaa\u{1F600}bbbb', 4, 'x.md').startsWith('aaa\n\n[continuum] This note is 9 characters and only the first 3'));
    assert(F.fit('abcé̂fgh', 4, 'x.md').startsWith('abc\n\n[continuum]'));
    // A fence left open by the cut is closed before the notice, with its own character and length.
    assert(F.fit('intro\n````js\ncode\nmore code\nend\n````\n', 28, 'x.md').startsWith('intro\n````js\ncode\nmore code\n````\n\n[continuum] This note'));
    assert(F.fit('~~~\n```\ninside\nmore inside\n', 18, 'x.md').startsWith('~~~\n```\ninside\n~~~\n\n[continuum]'));
    assert.equal(F.realSplit('node split-note.js --dry-run plan.json'), false); assert.equal(F.realSplit('node split-note.js --host codex plan.json'), true);
  });
  step('an over-limit start page is cut at a line break with the notice, and the start line names it', () => {
    setLimit(5000);
    const original = read('START HERE.md');
    write('START HERE.md', original + '\n## Extra\n\n' + filler('start', 60));
    const text = ctx(hook('session-start', { source: 'startup' }));
    const kept = noticed(text, 'START HERE.md', read('START HERE.md'));
    assert(kept <= 5000 && /\r?\n/.test(read('START HERE.md').slice(kept, kept + 2)));
    assert(text.includes(read('START HERE.md').slice(0, kept)));
    assert(text.startsWith('[continuum] Notes too large to load whole: START HERE.md ('), 'the start line comes first');
    write('START HERE.md', original);
    assert(!ctx(hook('session-start', { source: 'startup' })).includes('Notes too large'), 'no start line when no note is over');
  });
  step('the whole Working Agreements note (no numbered rules) over the limit gets the notice', () => {
    const original = read('Knowledge/Working Agreements.md');
    write('Knowledge/Working Agreements.md', fm('working agreements', 'working-agreements') + '# Rules\n\n## 1. First\n\n' + filler('rule', 60));
    const text = ctx(hook('session-start', { source: 'startup' }));
    assert(text.includes('(The full Knowledge/Working Agreements.md note follows'));
    const body = read('Knowledge/Working Agreements.md').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    noticed(text, 'Knowledge/Working Agreements.md', body);
    assert.match(text, /Notes too large to load whole: .*Knowledge\/Working Agreements\.md/);
    // The size check counts the text the loader loads (no frontmatter here), and a cut note is not "already loaded in full".
    assert(run('status').stdout.includes('over the limit: Knowledge/Working Agreements.md, ' + body.length + ' characters'));
    const next = ctx(hook('prompt-route', { prompt: 'the working agreements' }));
    assert(!next.includes('already loaded in full') && next.includes('[continuum] This note is'));
    write('Knowledge/Working Agreements.md', original);
  });
  step('a routed note over the limit gets the notice; one that fits is loaded whole', () => {
    write('Knowledge/Big.md', fm('big topic', 'big') + '# Big\n\n' + filler('big', 60));
    write('Knowledge/Near.md', fm('near topic', 'near') + '# Near\n\n' + filler('near', 50));
    write('Knowledge/Small.md', fm('small topic', 'small') + '# Small\n\nSMALL BODY\n');
    const source = read('Knowledge/Big.md');
    const big = ctx(hook('prompt-route', { prompt: 'tell me about the big topic' }));
    const kept = noticed(big, 'Knowledge/Big.md', source);
    assert(kept <= 5000);
    const small = ctx(hook('prompt-route', { prompt: 'small topic please' }));
    assert(small.includes('SMALL BODY') && !small.includes('[continuum] This note is'));
  });
  step('status and consolidate --status list over and close notes with size and percent', () => {
    const near = read('Knowledge/Near.md').length;
    assert(near >= 4000 && near <= 5000, 'fixture is close: ' + near);
    const out = run('status').stdout;
    assert.match(out, /INFO over the limit: Knowledge\/Big\.md, \d+ characters \(\d+%\)/);
    assert.match(out, new RegExp('INFO close to the limit: Knowledge/Near\\.md, ' + near + ' characters \\(' + Math.round(near / 50) + '%\\)'));
    assert(!/FAIL/.test(out), 'an over-limit note does not fail status');
    const st = run('consolidate', ['--status']).stdout;
    assert.match(st, /Note sizes \(load limit 5000 characters\): 1 over, 1 close/); assert.match(st, /- over the limit: Knowledge\/Big\.md/);
  });
  step('the nightly files one split proposal per close or over note, and none on a second run', () => {
    const first = run('consolidate', ['--nightly']).stdout;
    assert.match(first, /2 new split proposals for large notes\./);
    const rows = () => read('Log/proposals.md').split('\n').filter(l => /^\| p\d+ \|.*\| split \|/.test(l));
    assert.equal(rows().length, 2);
    assert(rows().some(r => r.includes('| Knowledge/Big.md |') && /% of the load limit/.test(r) && r.includes('| Big |')));
    assert.match(run('consolidate', ['--weekly']).stdout, /0 new split proposals for large notes\./);
    assert.equal(rows().length, 2);
  });
  // A note with ## sections, a ### subsection and long dated top-level entries; one line appears twice on purpose.
  const ledger = fm('ledger', 'ledger') + '# Ledger\n\nIntro that stays.\n\n## Billing\n\nInvoices go out monthly.\nSame line.\n\n### Billing detail\n\n' +
    filler('billing', 8) + '\n## Travel\n\nTrips and fares.\n\n## Log\n\n' +
    Array.from({ length: 20 }, (_, i) => '- 2026-0' + (1 + (i % 9)) + '-1' + (i % 10) + ': entry ' + i + ' ' + (i % 2 ? 'trip fare ' : 'invoice paid ') + 'words '.repeat(25).trim() +
      '\n  continued detail for entry ' + i + '.\n' + (i === 3 ? 'Same line.\n' : '')).join('') + '\n## Notes\n\nClosing text that stays.\n';
  const entry = i => ledger.split('\n').find(l => l.startsWith('- ') && l.includes(': entry ' + i + ' '));
  const block = (text, first, endRx) => { const at = text.indexOf(first + '\n'); const rest = text.slice(at + first.length + 1); const m = rest.search(endRx); return text.slice(at, at + first.length + 1 + (m < 0 ? rest.length : m)); };
  const ledgerPlan = () => ({ source: 'Knowledge/Ledger.md', notes: [
    { title: 'Ledger Billing', about: 'Billing from the ledger', when_to_use: 'ledger billing, invoices', blocks: ['## Billing'] },
    { title: 'Ledger Travel', about: 'Travel from the ledger', when_to_use: 'ledger travel, trip fares', pattern: 'ledger-travel', blocks: ['## Travel', entry(1), entry(3), entry(5)] },
    { title: 'Ledger Log', about: 'Older log entries', when_to_use: 'ledger log, old entries', blocks: [entry(0), entry(2), entry(4), entry(6), entry(8)] }] });
  step('a dry run prints the numbers and changes no file in the vault', () => {
    write('Knowledge/Ledger.md', ledger);
    const before = snapshot(true);
    const out = split(['--dry-run', plan(ledgerPlan())]).stdout;
    assert.match(out, /^Dry run: nothing was changed\./); assert.match(out, /- Ledger Billing \(new note Knowledge\/Ledger Billing\.md\): 1 block\(s\), \d+ characters/);
    assert.match(out, /- Ledger Travel .*: 4 block\(s\)/); assert.match(out, /Main note after the split: \d+ characters \(\d+% of the load limit\)/);
    assert.match(out, /Every block was found exactly once\./);
    same(before, snapshot(true));
    const bad = split(['--dry-run', plan({ ...ledgerPlan(), notes: [{ title: 'X', about: 'x', when_to_use: 'x', blocks: ['## Nowhere'] }] })], 1).stdout;
    assert.match(bad, /Block "## Nowhere": not found in Knowledge\/Ledger\.md\./);
    same(before, snapshot(true));
    assert.match(split([]).stdout, /Dry run first/);
  });
  step('a real split moves each block byte for byte, keeps a dated copy, adds Subject notes, indexes and routes the new notes', () => {
    const out = split([plan(ledgerPlan())]).stdout;
    assert.match(out, /every block was found byte for byte in its place and every line of the old note exactly once/);
    const billing = read('Knowledge/Ledger Billing.md'); const travel = read('Knowledge/Ledger Travel.md'); const log = read('Knowledge/Ledger Log.md');
    assert(billing.includes(block(ledger, '## Billing', /^## /m)) && billing.includes('### Billing detail'));
    assert(travel.includes(block(ledger, '## Travel', /^## /m)));
    for (const i of [1, 3, 5]) assert(travel.includes(block(ledger, entry(i), /^(?:- |#)/m)), 'entry ' + i);
    for (const i of [0, 2, 4, 6, 8]) assert(log.includes(block(ledger, entry(i), /^(?:- |#)/m)), 'entry ' + i);
    assert.match(travel, /^---\ntype: reference\npattern: ledger-travel\nabout: "Travel from the ledger"\nwhen_to_use: "ledger travel, trip fares"\n[\s\S]*status: active[\s\S]*# Ledger Travel\n\nMade \d{4}-\d{2}-\d{2}\. The entries below were moved word for word from \[\[Ledger\]\]\./);
    const main = read('Knowledge/Ledger.md');
    assert.match(main, /## Subject notes\n\nA new entry goes into the note for its subject, not into this main note\.\n\n- \[\[Ledger Billing\]\]: Billing from the ledger\n- \[\[Ledger Travel\]\]/);
    assert(main.includes('Intro that stays.') && main.includes('Closing text that stays.') && main.includes(entry(7)) && !main.includes(entry(1)));
    const copies = fs.readdirSync(path.join(vault, '.backups'), { recursive: true }).filter(f => f.endsWith('Ledger.md'));
    assert.equal(copies.length, 1); assert.equal(fs.readFileSync(path.join(vault, '.backups', copies[0]), 'utf8'), ledger);
    // The every-line check, done here independently: the old note's non-blank lines, as a multiset.
    const lines = t => t.split('\n').filter(l => l.trim()).sort();
    const added = main.slice(main.indexOf('\n## Subject notes'));
    const moved = [billing, travel, log].map(t => t.slice(t.indexOf('word for word from [[Ledger]].') + 31));
    assert.deepEqual(lines(main.slice(0, main.length - added.length) + '\n' + moved.join('\n')), lines(ledger));
    assert.match(read('Log/index.md'), /Ledger Travel/);
    assert.match(ctx(hook('prompt-route', { prompt: 'what were the trip fares in the ledger travel' })), /--- Knowledge\/Ledger Travel\.md ---/);
    assert.match(fs.readdirSync(p('Log')).filter(f => f.startsWith('decisions-')).map(f => read('Log/' + f)).join(''), /action: split note \| vault-delete \| outcome: split, every block and line checked/);
  });
  step('a split into a subject note that already exists appends under a dated heading and extends the Subject notes list', () => {
    write('Knowledge/Ledger Archive.md', fm('ledger archive', 'ledger-archive') + '# Ledger Archive\n\nOlder material.\n');
    const before = read('Knowledge/Ledger Archive.md');
    split([plan({ source: 'Knowledge/Ledger.md', notes: [{ title: 'Ledger Archive', about: 'Archived entries', when_to_use: 'ledger archive', blocks: [entry(7), entry(9)] }] })]);
    const after = read('Knowledge/Ledger Archive.md');
    assert(after.startsWith(before) && /\n## Moved from \[\[Ledger\]\] on \d{4}-\d{2}-\d{2} \(word for word\)\n\n- /.test(after.slice(before.length)));
    assert(after.includes(block(ledger, entry(7), /^(?:- |#)/m)) && after.includes(block(ledger, entry(9), /^(?:- |#)/m)));
    const main = read('Knowledge/Ledger.md');
    assert.equal(main.match(/## Subject notes/g).length, 1); assert.equal(main.match(/\[\[Ledger Travel\]\]/g).length, 1);
    assert.match(main, /- \[\[Ledger Log\]\]: Older log entries\n- \[\[Ledger Archive\]\]: Archived entries\n/);
  });
  step('every failure path leaves every file byte-identical', () => {
    write('Knowledge/Twice.md', fm('twice', 'twice') + '# Twice\n\n## A\n\n- 2026-01-01: same start\n  one\n\n## B\n\n- 2026-01-01: same start\n  two\n');
    const before = snapshot(true);
    const fail = (obj, rx) => { const r = split([plan(obj)], 1); assert.match(r.stderr, rx); assert.match(r.stderr, /nothing was changed/i); same(before, snapshot(true)); };
    fail({ source: 'Knowledge/Twice.md', notes: [{ title: 'T1', about: 'a', when_to_use: 't1', blocks: ['## Missing'] }] }, /"## Missing": not found/);
    fail({ source: 'Knowledge/Twice.md', notes: [{ title: 'T1', about: 'a', when_to_use: 't1', blocks: ['- 2026-01-01: same start'] }] }, /found 2 times \(lines \d+, \d+\)/);
    fail({ source: 'Knowledge/Gone.md', notes: [{ title: 'T1', about: 'a', when_to_use: 't1', blocks: ['## A'] }] }, /does not exist/);
    fail({ source: 'Knowledge/Twice.md', vault: temp, notes: [{ title: 'T1', about: 'a', when_to_use: 't1', blocks: ['## A'] }] }, /another vault/);
    // A target that cannot be written: the first subject note is made, the second refuses; all is put back.
    write('Knowledge/Locked.md', fm('locked', 'locked') + '# Locked\n');
    fs.chmodSync(p('Knowledge/Locked.md'), 0o444);
    const locked = snapshot(); const backups = fs.existsSync(p('.backups')) ? fs.readdirSync(p('.backups'), { recursive: true }).length : 0;
    const r = split([plan({ source: 'Knowledge/Twice.md', notes: [{ title: 'T New', about: 'a', when_to_use: 'tnew', blocks: ['## A'] },
      { title: 'Locked', about: 'b', when_to_use: 'locked', blocks: ['## B'] }] })], process.getuid && process.getuid() === 0 ? null : 1);
    fs.chmodSync(p('Knowledge/Locked.md'), 0o644);
    if (r.status === 1) {
      assert.match(r.stderr, /^The split failed \(.+\), so nothing was changed: Knowledge\/Twice\.md is as it was and no subject note was made or changed\./);
      same(locked, snapshot()); assert(!fs.existsSync(p('Knowledge/T New.md')));
      assert(fs.readdirSync(p('.backups'), { recursive: true }).length > backups, 'the dated copy taken first is kept');
    } else console.log('  (running as root: a read-only file is still writable, so the unwritable-target case was not exercised)');
  });
  step('the gate asks before a real split and not before a dry run, on Claude Code and on Codex', () => {
    const script = path.join(root, 'scripts', 'split-note.js'); const planFile = path.join(temp, 'plan.json');
    const gate = (command, host) => hook('action-gate', { tool_name: 'Bash', tool_input: { command }, tool_use_id: 'c1' }, host);
    const real = (gate('node "' + script + '" "' + planFile + '"').hookSpecificOutput || {});
    assert.equal(real.permissionDecision, 'ask'); assert.match(real.permissionDecisionReason, /^\[continuum\] vault-delete: This would delete, move, empty or rewrite/);
    assert.deepEqual(gate('node "' + script + '" --dry-run "' + planFile + '"'), {});
    const codex = gate('node "' + script + '" --host codex "' + planFile + '"', ['--host', 'codex']).hookSpecificOutput || {};
    assert.equal(codex.permissionDecision, 'deny'); assert(codex.permissionDecisionReason.includes('" --host codex vault-delete "<their words>"'));
    assert.deepEqual(gate('node "' + script + '" --host codex --dry-run "' + planFile + '"', ['--host', 'codex']), {});
    assert.match(ctx(hook('session-start', { source: 'startup' }, ['--host', 'codex'])), /split-note\.js" --host codex --dry-run <plan\.json>/);
  });
  step('standing rules numbered 10 and above are loaded, and the size check measures exactly the rules the loader emits', () => {
    const original = read('Knowledge/Working Agreements.md');
    const rules = Array.from({ length: 12 }, (_, i) => (i + 1) + '. Rule number ' + (i + 1) + ' ' + 'x'.repeat(30) + '.');
    write('Knowledge/Working Agreements.md', fm('working agreements', 'working-agreements') + '# Rules\n\n## Standing rules\n\n' + rules.join('\n') + '\n\n## Notes\n\n' + filler('notes', 70));
    const text = ctx(hook('session-start', { source: 'startup' }));
    assert(text.includes('[continuum] Standing rules\n\n' + rules.join('\n\n')), 'all twelve rules, in order');
    const F = require('../scripts/lib/filing');
    const e = { rel: 'Knowledge/Working Agreements.md', file: p('Knowledge/Working Agreements.md'), name: 'Working Agreements', text: read('Knowledge/Working Agreements.md'), fm: {} };
    const emitted = rules.join('\n\n').length;
    const c = { vault, inject: { startPage: 'START HERE.md', maxNoteChars: emitted - 1 } };
    assert.deepEqual(F.sizes(c, [e]).map(r => [r.rel, r.chars, r.state]), [['Knowledge/Working Agreements.md', emitted, 'over']]);
    assert.deepEqual(F.sizes({ ...c, inject: { ...c.inject, maxNoteChars: emitted * 2 } }, [e]), [], 'the long note body is not what the start loads');
    write('Knowledge/Working Agreements.md', original);
  });
  step('codex: start text longer than the installed additionalContextLimit gets one line first; status and the nightly report it', () => {
    const cmd = 'node "' + root.split(path.sep).join('/') + '/scripts/session-start.js" --host codex';
    write('.codex/hooks.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: cmd, additionalContextLimit: 3000 }] }] } }));
    const text = ctx(hook('session-start', { source: 'startup' }, ['--host', 'codex']));
    const m = text.match(/^\[continuum\] This start text is (\d+) characters and Codex loads only the first 3000, so the end is missing\. Read START HERE\.md and Knowledge\/Working Agreements\.md/);
    assert(m, text.slice(0, 300)); assert.equal(Number(m[1]), text.length);
    assert.match(run('status', ['--host', 'codex'], undefined, null).stdout, /INFO codex start text: \d+ characters, Codex loads only the first 3000 \(largest part: /);
    assert.match(run('consolidate', ['--host', 'codex', '--nightly']).stdout, /[1-9] new split proposals for large notes/);
    assert.match(read('Log/proposals.md'), /\| split \| (?:START HERE\.md|Knowledge\/Working Agreements\.md) \| .*Codex start text \d+ characters; Codex loads only the first 3000/);
    fs.rmSync(p('.codex'), { recursive: true });
    assert(!ctx(hook('session-start', { source: 'startup' })).includes('Codex loads only'), 'never on Claude Code');
  });
  console.log('PASS filing: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL filing after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
