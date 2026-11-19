#!/usr/bin/env node
'use strict';
// Split a note that has grown too large into a short main note and subject notes. The assistant decides which
// entries go where (the plan); this script moves the text exactly, proves nothing was lost, and puts everything
// back when a step fails. It never deletes, shortens or rewords text. A real run rewrites notes, so the gate asks.
// Crash safety: a lock, then dated copies and a journal under .backups/<date>/<batch>/, then every file is written
// through a temporary file and a rename; the journal is marked finished last. --recover undoes an unfinished run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./lib/config');
const V = require('./lib/vault');
const D = require('./decision-log');
const F = require('./lib/filing');
const S = require('./lib/split-plan');
const ST = require('./lib/split-state');

const CLOSE = 'Close the note in other programs for the few seconds a split runs: a save from another program in that moment cannot be detected.';
const USAGE = [
  'Split a large note into a short main note and subject notes, moved word for word.',
  '',
  '1. Write a plan file (JSON), for example:',
  '   {"source": "Knowledge/Big.md", "notes": [{"title": "Big Billing", "about": "Billing entries from Big",',
  '     "when_to_use": "billing, invoices", "blocks": ["## Billing", "- 2026-01-05: Invoice sent"]}]}',
  '   A block is the exact first line of a ## or ### section, or of a top-level "- " entry in the source note.',
  '2. Dry run first; it changes nothing and prints the numbers to show the person:',
  '   node split-note.js --dry-run plan.json',
  '3. Only after the person says yes: node split-note.js plan.json',
  'Use - in place of plan.json to read the plan from standard input. ' + CLOSE,
  'If a split was interrupted: node split-note.js --recover puts the notes back as they were.',
  'When notes a split left alone have been settled with the person: node split-note.js --recover --resolved'
].join('\n');
const plain = message => Object.assign(new Error(message), { plain: true });
const rel = (c, file) => path.relative(c.vault, file).split(path.sep).join('/');
const readText = file => fs.readFileSync(file, 'utf8');
const shaOf = file => { try { return S.sha(fs.readFileSync(file)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// Tests only: CONTINUUM_TEST_SPLIT_CRASH=N exits hard just before write number N (no catch, no cleanup, like a kill);
// CONTINUUM_TEST_SPLIT_MEDDLE=N:<vault path> appends a line to that note just before write N (another writer).
let writes = 0;
function tick(c) {
  writes++;
  const meddle = String(process.env.CONTINUUM_TEST_SPLIT_MEDDLE || '').match(/^(\d+):(.+)$/);
  if (meddle && Number(meddle[1]) === writes) fs.appendFileSync(C.vaultPath(c, meddle[2]), 'written by someone else\n');
  if (Number(process.env.CONTINUUM_TEST_SPLIT_CRASH) === writes) process.exit(70);
}
const tmpOf = (file, batch) => file + '.' + batch + '.split-tmp';
// Every changed or new file: a temporary file in the same folder, then the expected-bytes check, then the rename.
function atomic(c, file, content, batch, guard) {
  tick(c); fs.writeFileSync(tmpOf(file, batch), content, { flag: 'wx' });
  tick(c); if (guard) guard();
  fs.renameSync(tmpOf(file, batch), file);
}
// The undo writes the same way, without the test counter.
function put(file, content, batch) { fs.writeFileSync(tmpOf(file, batch), content); fs.renameSync(tmpOf(file, batch), file); }
// Puts back what a run wrote, from the journal and its copies. A note is touched only when it holds exactly what this
// run wrote, and a copy is used only when it matches the digest recorded when it was taken.
// left: notes something else changed (left as they are); bad: notes whose copy cannot be trusted (split stays unfinished).
function undo(c, j) {
  const left = []; const bad = [];
  const dir = C.vaultPath(c, j.dir);
  const restore = (r, file, want) => {
    const copy = path.join(dir, ...r.split('/'));
    const bytes = fs.existsSync(copy) ? fs.readFileSync(copy) : null;
    if (!bytes || S.sha(bytes) !== want) bad.push({ rel: r, why: 'its copy ' + j.dir + '/' + r + (bytes ? ' does not match the digest recorded when it was taken' : ' is missing') });
    else put(file, bytes, j.batch);
  };
  const src = C.vaultPath(c, j.source);
  const now = shaOf(src);
  if (now === j.mainSha) restore(j.source, src, j.sourceSha);
  else if (now !== j.sourceSha) left.push({ rel: j.source, why: 'changed by something else' });
  for (const t of j.targets) {
    const file = C.vaultPath(c, t.rel);
    const cur = shaOf(file);
    if (t.created) {
      // Never delete a file this run did not make: made = its exclusive create succeeded; making = the create was
      // under way when the run stopped, and the file is still the empty one that create leaves.
      const ours = j.made.includes(t.rel) || (j.making === t.rel && cur !== null && fs.statSync(file).size === 0);
      if (!ours || cur === null) continue;
      if (cur === t.sha || fs.statSync(file).size === 0) fs.unlinkSync(file); else left.push({ rel: t.rel, why: 'changed by something else' });
    } else if (cur === t.sha) restore(t.rel, file, t.beforeSha);
    else if (cur !== t.beforeSha) left.push({ rel: t.rel, why: 'changed by something else' });
  }
  for (const r of [j.source, ...j.targets.map(t => t.rel), j.journal]) {
    try { fs.unlinkSync(tmpOf(C.vaultPath(c, r), j.batch)); } catch (_) { /* none left */ }
  }
  // The index is rebuilt only when this run rebuilt it, so an undo leaves it exactly as it was otherwise.
  try { if (fs.statSync(C.vaultPath(c, 'Log', 'index.md')).mtimeMs >= j.started) V.buildIndex(c); } catch (_) { /* rebuilt at the next session start */ }
  return { left, bad };
}
// After an undo: a copy that cannot be trusted keeps the split unfinished (journal and lock stay); notes left alone
// put it in "needs attention" (reported until --recover --resolved); otherwise it is closed. Returns the state.
function settle(c, j, res, closed) {
  const journal = C.vaultPath(c, j.journal);
  if (res.bad.length) return 'running';
  j.state = res.left.length ? 'needs attention' : closed;
  j.left = res.left;
  put(journal, JSON.stringify(j, null, 1), j.batch);
  if (res.left.length) ST.setAttention(c, [...ST.attention(c), j.journal]);
  ST.releaseLock(c);
  return j.state;
}
const listOf = items => items.map(x => x.rel + ' (' + x.why + ')').join(', ');
function refuseIfBusy(c) {
  const u = ST.lockStatus(c);
  if (!u) return;
  if (u.kind === 'running') throw plain('A split of ' + u.journal.source + ' did not finish. Run ' + F.command('--recover') + ' first; nothing was changed.');
  if (u.kind === 'live') throw plain('A split or a recovery is running now' + (u.lock.pid ? ' (process ' + u.lock.pid + ')' : '') + '; nothing was changed.');
  throw plain('A split lock is left in .backups/split-note.lock and no split is running under it. Run ' + F.command('--recover') + ' to clear it; nothing was changed.');
}

function real(c, p) {
  if (p.problems.length) throw plain('The plan has problems, so nothing was changed:\n- ' + p.problems.join('\n- '));
  refuseIfBusy(c);
  const batch = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const dir = C.vaultPath(c, '.backups', C.date(c), batch);
  const j = { state: 'running', vault: c.vault, batch, started: Date.now(), dir: rel(c, dir), journal: rel(c, path.join(dir, 'split-journal.json')),
    source: p.rel, sourceSha: S.sha(p.bytes), mainSha: S.sha(p.main), made: [],
    targets: p.targets.map(t => ({ rel: t.rel, created: !t.before, sha: S.sha(t.final), beforeSha: t.before ? S.sha(t.before) : null })) };
  const journal = C.vaultPath(c, j.journal);
  tick(c);
  try { ST.takeLock(c, { kind: 'split', batch, journal: j.journal }); }
  catch (e) { throw plain('Another split holds the lock (' + e.code + '); nothing was changed.'); }
  // Just before each rename: the source and every target still hold exactly what this run expects.
  const expect = new Map([[p.file, S.sha(p.bytes)], ...p.targets.map(t => [t.file, t.before ? S.sha(t.before) : null])]);
  const guard = () => { for (const [file, want] of expect) if (shaOf(file) !== want) throw new Error(rel(c, file) + ' was changed by something else while the split ran'); };
  let wrote = false;
  try {
    tick(c); require('./action-gate').backup(c, p.file, batch); // the dated copy, with the gate's own helper
    for (const t of p.targets) if (t.before) { tick(c); require('./action-gate').backup(c, t.file, batch); }
    for (const [file, b] of [[p.file, p.bytes], ...p.targets.filter(t => t.before).map(t => [t.file, t.before])]) {
      if (!fs.readFileSync(path.join(dir, rel(c, file))).equals(b)) throw new Error('the copy of ' + rel(c, file) + ' could not be checked');
    }
    atomic(c, journal, JSON.stringify(j, null, 1), batch);
    wrote = true;
    for (const t of p.targets) {
      if (!t.before) { // counted as made by this run only once its exclusive create succeeded
        j.making = t.rel; atomic(c, journal, JSON.stringify(j, null, 1), batch, guard);
        tick(c);
        try { guard(); fs.closeSync(fs.openSync(t.file, 'wx')); } catch (e) { j.making = null; throw e; } // a failed create is never ours
        j.made.push(t.rel); j.making = null; expect.set(t.file, S.sha(''));
        atomic(c, journal, JSON.stringify(j, null, 1), batch);
      }
      atomic(c, t.file, t.final, batch, guard);
      expect.set(t.file, S.sha(t.final));
    }
    atomic(c, p.file, p.main, batch, guard); // only now the main note changes
    expect.set(p.file, S.sha(p.main));
    S.prove(p, readText);
    tick(c); V.buildIndex(c);
    j.state = 'finished';
    atomic(c, journal, JSON.stringify(j, null, 1), batch, guard); // the last step of the split itself
  } catch (e) {
    let res = { left: [], bad: [] };
    let state = 'rolled back';
    if (wrote) {
      try { res = undo(c, j); state = settle(c, j, res, 'rolled back'); }
      catch (x) { res.bad.push({ rel: j.source, why: 'the undo itself failed: ' + x.message }); state = 'running'; }
    } else ST.releaseLock(c);
    if (state === 'running') {
      throw plain('The split failed (' + e.message + ') and could not be put back: ' + listOf(res.bad) + '. The split is still unfinished; run ' +
        F.command('--recover') + ' after checking the copies in ' + j.dir + '.');
    }
    throw plain(res.left.length
      ? 'The split failed (' + e.message + '). These notes were left as they are now, because something else changed them: ' + listOf(res.left) +
        '. Look at them with the person and compare them with the copies in ' + j.dir + '; status keeps reporting this until ' + F.command('--recover --resolved') + '.'
      : 'The split failed (' + e.message + '), so nothing was changed: ' + p.rel + ' is as it was and no subject note was made or changed.');
  }
  ST.releaseLock(c);
  D.append(c, 'action: split note', 'vault-delete', 'split, every block and line checked', p.rel + ' into ' + p.targets.map(t => t.rel).join(', ') +
    '; copies at ' + j.dir);
  return ['Split ' + p.rel + ' into ' + p.targets.length + ' subject note(s); every block was found byte for byte in its place and every line of the old note exactly once.',
    ...p.targets.map(t => '- ' + t.rel + ': ' + t.blocks.length + ' block(s), ' + t.moved.length + ' characters' + (t.before ? ' (added to the existing note)' : ' (new note)')),
    'Main note now: ' + p.main.length + ' characters (load limit ' + c.inject.maxNoteChars + ').',
    'Copy of the note as it was: ' + j.dir + '/' + p.rel,
    'Next: ask the person a few sample questions and check that each opens the right subject note.'].join('\n');
}
// --recover: under the same lock discipline as a run. --recover --resolved: the person has settled the notes a split
// left alone; only then do they stop being reported.
function recover(c, resolved) {
  const u = ST.lockStatus(c);
  if (u && u.kind === 'live') throw plain('A split or a recovery is running now' + (u.lock.pid ? ' (process ' + u.lock.pid + ')' : '') + '; nothing was changed.');
  if (resolved) {
    if (u) throw plain('A split did not finish or its lock is left; run ' + F.command('--recover') + ' first. Nothing was changed.');
    ST.takeLock(c, { kind: 'resolve' });
    try {
      const done = [];
      for (const r of ST.attention(c)) {
        try { const j = ST.readJournal(c, r); j.state = 'resolved by the person'; put(C.vaultPath(c, r), JSON.stringify(j, null, 1), j.batch); done.push(j.source); }
        catch (_) { done.push(r); }
      }
      ST.setAttention(c, []);
      return done.length ? 'Marked as settled by the person: the splits of ' + done.join(', ') + '. They are no longer reported.' : 'Nothing needed attention.';
    } finally { ST.releaseLock(c); }
  }
  if (!u) {
    const open = ST.attention(c);
    return open.length ? 'No unfinished split. ' + open.length + ' split(s) still need attention; status names the notes. After settling them with the person, run ' +
      F.command('--recover --resolved') + '.' : 'No unfinished split; nothing to do.';
  }
  if (u.kind === 'lock') {
    ST.takeOver(c, u.raw, { kind: 'recover' }); ST.releaseLock(c);
    return 'Cleared a split lock that no split was running under; no note was touched.';
  }
  if (u.bad) throw u.bad;
  const j = ST.readJournal(c, u.lock.journal); // this vault's, its own folder, only paths inside the vault
  ST.takeOver(c, u.raw, { kind: 'recover', batch: j.batch, journal: j.journal });
  const res = undo(c, j);
  const state = settle(c, j, res, 'recovered');
  if (state === 'running') {
    throw plain('Could not put back ' + listOf(res.bad) + '. Nothing else that needs that copy was touched and the split stays unfinished; look at ' + j.dir + ' with the person.');
  }
  return res.left.length
    ? 'Put back what the unfinished split of ' + j.source + ' wrote, except these notes, which something else changed since: ' + listOf(res.left) +
      '. Look at them with the person and compare them with the copies in ' + j.dir + '; status keeps reporting this until ' + F.command('--recover --resolved') + '.'
    : 'Put back everything the unfinished split of ' + j.source + ' wrote; the notes are as they were before it started.';
}
function dryRun(c, p) {
  const limit = c.inject.maxNoteChars;
  const pct = n => Math.round(n * 100 / limit) + '%';
  const out = ['Dry run: nothing was changed.', 'Source: ' + p.rel + ', ' + p.text.length + ' characters (' + pct(p.text.length) + ' of the load limit of ' + limit + ').'];
  for (const t of p.targets) {
    out.push('- ' + t.title + ' (' + (t.before ? 'existing note ' + t.rel + ', entries added at the end' : 'new note ' + t.rel) + '): ' +
      t.blocks.length + ' block(s), ' + t.moved.length + ' characters');
  }
  out.push('Main note after the split: ' + p.main.length + ' characters (' + pct(p.main.length) + ' of the load limit)' +
    (p.main.length > limit ? '; still over the limit, so more entries need a subject note.' : '.'));
  out.push(p.problems.length ? 'Problems to fix in the plan first:' : 'Every block was found exactly once.');
  p.problems.forEach(line => out.push('- ' + line));
  if (!p.problems.length) out.push('Show these numbers to the person. Run the same command without --dry-run only after their yes. ' + CLOSE);
  return out.join('\n');
}
function main(argv) {
  if (argv[0] === '--recover' && (argv.length === 1 || (argv.length === 2 && argv[1] === '--resolved'))) return { out: recover(C.load(), argv.length === 2), code: 0 };
  const args = argv.filter(a => a !== '--dry-run');
  const dry = args.length !== argv.length;
  if (!args.length || args.some(a => a === '--help' || a === '-h') || args.length > 1) return { out: USAGE, code: args.length > 1 ? 1 : 0 };
  const c = C.load();
  let plan;
  try { plan = JSON.parse((args[0] === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(C.normalize(args[0])), 'utf8')).replace(/^﻿/, '')); }
  catch (e) { throw plain('The plan could not be read as JSON (' + e.message + '), so nothing was changed.'); }
  refuseIfBusy(c);
  const p = S.prepare(c, plan);
  if (dry) return { out: dryRun(c, p), code: p.problems.length ? 1 : 0 };
  return { out: real(c, p), code: 0 };
}
module.exports = { main, undo };
if (require.main === module) {
  try { const r = main(process.argv.slice(2)); console.log(r.out); process.exitCode = r.code; }
  catch (e) { console.error(e.plain ? e.message : 'Nothing was changed: ' + e.message); process.exitCode = 1; }
}
