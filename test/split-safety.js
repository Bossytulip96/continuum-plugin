'use strict';
// split-note.js under stress: a kill at every write and --recover, other writers, the lock, paths through links,
// the exact proof and the fence-aware parser. Real child processes against a throwaway home, config and vault.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-split-'));
const home = path.join(temp, 'home');
const vault = path.join(temp, 'vault');
const outside = path.join(temp, 'outside');
const file = path.join(temp, 'config', 'config.json');
const env = { ...process.env, USERPROFILE: home, HOME: home, CONTINUUM_CONFIG: file, CLAUDE_CONFIG_DIR: path.join(temp, 'claude'),
  CODEX_HOME: path.join(temp, 'codex-home'), CONTINUUM_DESKTOP: path.join(temp, 'desktop') };
for (const k of ['CONTINUUM_DEBUG', 'CONTINUUM_HOST', 'CONTINUUM_TEST_SPLIT_CRASH', 'CONTINUUM_TEST_SPLIT_MEDDLE']) delete env[k];
let checks = 0;
function run(name, args = [], extra = {}, input) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), ...args], { cwd: root, env: { ...env, ...extra },
    encoding: 'utf8', timeout: 20000, input: input === undefined ? '' : JSON.stringify(input) });
  assert.ifError(r.error);
  return r;
}
const step = (name, fn) => { fn(); checks++; console.log('PASS split-safety ' + checks + ': ' + name); };
const p = rel => path.join(vault, ...rel.split('/'));
const read = rel => fs.readFileSync(p(rel), 'utf8');
const write = (rel, text) => { fs.mkdirSync(path.dirname(p(rel)), { recursive: true }); fs.writeFileSync(p(rel), text); };
const fm = (terms, pattern) => '---\ntype: reference\npattern: ' + pattern + '\nabout: Fixture\nwhen_to_use: "' + terms + '"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\n';
function snapshot() {
  const out = new Map();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) { if (e.name !== '.backups') walk(f); } else if (!e.isSymbolicLink()) out.set(path.relative(vault, f), fs.readFileSync(f));
    }
  })(vault);
  return out;
}
function same(a, b, why) {
  assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort(), why);
  for (const [k, v] of a) assert(v.equals(b.get(k)), k + ' changed (' + why + ')');
}
const planFile = obj => { const f = path.join(temp, 'plan.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
const split = (args, extra) => run('split-note', args, extra);
const index = () => run('session-start', [], {}, { session_id: 's', cwd: vault, hook_event_name: 'SessionStart', source: 'startup' });
const entries = n => Array.from({ length: n }, (_, i) => '- 2026-02-1' + i + ': entry ' + i + ' ' + 'word '.repeat(20).trim() + '\n  more for ' + i + '\n').join('');
const source = fm('stress', 'stress') + '# Stress\n\nKept intro.\n\n## Alpha\n\nalpha text\nShared line.\n\n## Beta\n\nbeta text\n\n## Log\n\n' + entries(6) + 'Shared line.\n';
const plan = () => ({ source: 'Knowledge/Stress.md', notes: [
  { title: 'Stress Alpha', about: 'Alpha', when_to_use: 'stress alpha', blocks: ['## Alpha'] },
  { title: 'Stress Old', about: 'Older entries', when_to_use: 'stress old', blocks: [read('Knowledge/Stress.md').split('\n').find(l => l.includes(': entry 4 ')), read('Knowledge/Stress.md').split('\n').find(l => l.includes(': entry 1 '))] },
  { title: 'Stress Existing', about: 'Beta', when_to_use: 'stress existing', blocks: ['## Beta'] }] });
try {
  run('setup', ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no']);
  write('Knowledge/Stress.md', source);
  write('Knowledge/Stress Existing.md', fm('stress existing', 'stress-existing') + '# Stress Existing\n\nAlready here.\n');
  index();
  step('a kill at every write leaves an unfinished split that status and session start name; --recover puts every file back byte for byte', () => {
    const before = snapshot();
    let n = 1;
    for (;; n++) {
      const r = split([planFile(plan())], { CONTINUUM_TEST_SPLIT_CRASH: String(n) });
      if (r.status === 0) break;
      assert.equal(r.status, 70, 'write ' + n + ': ' + r.stderr + r.stdout);
      const journal = fs.existsSync(p('.backups')) && fs.readdirSync(p('.backups'), { recursive: true }).some(f => f.endsWith('split-journal.json') && /"running"/.test(fs.readFileSync(path.join(p('.backups'), f), 'utf8')));
      const st = run('status').stdout;
      if (journal) {
        assert.match(st, /FAIL \[continuum\] A note split did not finish: Knowledge\/Stress\.md\. Before anything else run node ".*split-note\.js" --recover/);
        assert.match(JSON.parse(index().stdout).hookSpecificOutput.additionalContext, /^\[continuum\] A note split did not finish: Knowledge\/Stress\.md/);
        const busy = split(['--dry-run', planFile(plan())]);
        assert.equal(busy.status, 1); assert.match(busy.stderr, /did not finish\. Run .* --recover first; nothing was changed/);
      } else if (fs.existsSync(p('.backups/split-note.lock'))) assert.match(st, /INFO \[continuum\] A split lock was left/);
      else assert(!st.includes('[continuum]'), 'killed before the lock: nothing to report');
      const locked = fs.existsSync(p('.backups/split-note.lock'));
      const rec = split(['--recover']);
      assert.equal(rec.status, 0, rec.stderr);
      assert.match(rec.stdout, journal ? /Put back everything the unfinished split of Knowledge\/Stress\.md wrote/ : locked ? /Cleared a split lock/ : /No unfinished split/);
      same(before, snapshot(), 'after a kill before write ' + n);
      assert(!fs.existsSync(p('.backups/split-note.lock')));
    }
    assert(n > 20, 'the kill was tried at ' + (n - 1) + ' writes');
    assert.match(read('Knowledge/Stress Existing.md'), /## Moved from \[\[Stress\]\]/);
    assert.match(split(['--recover']).stdout, /No unfinished split/);
  });
  step('the lock: a stale one is reported and never broken; a live one stops the run', () => {
    write('Knowledge/Stress.md', source); write('Knowledge/Stress Existing.md', fm('stress existing', 'stress-existing') + '# Stress Existing\n\nAlready here.\n');
    for (const f of ['Stress Alpha', 'Stress Old']) fs.rmSync(p('Knowledge/' + f + '.md'));
    index();
    const before = snapshot();
    fs.writeFileSync(p('.backups/split-note.lock'), JSON.stringify({ pid: 999999, started: Date.now() - 3600000, batch: 'x', journal: '.backups/none/x/split-journal.json' }));
    let r = split([planFile(plan())]);
    assert.equal(r.status, 1); assert.match(r.stderr, /A split lock is left .*nothing was changed/);
    assert.match(run('status').stdout, /INFO \[continuum\] A split lock was left/);
    assert(fs.existsSync(p('.backups/split-note.lock')), 'a stale lock is never removed by a run');
    // A lock whose process is alive is a run, whatever its age: a run and --recover both refuse and leave it.
    const live = JSON.stringify({ pid: process.pid, started: Date.now() - 24 * 3600000, batch: 'y', journal: '.backups/none/y/split-journal.json' });
    fs.writeFileSync(p('.backups/split-note.lock'), live);
    for (const args of [[planFile(plan())], ['--recover'], ['--recover', '--resolved']]) {
      r = split(args);
      assert.equal(r.status, 1, args.join(' ')); assert.match(r.stderr, /A split or a recovery is running now \(process \d+\); nothing was changed/);
      assert.equal(fs.readFileSync(p('.backups/split-note.lock'), 'utf8'), live);
    }
    assert(!run('status').stdout.includes('[continuum]'), 'a live run is not reported as left over');
    // An empty or unreadable lock younger than two minutes may be a run writing it: live. Older: left over, and --recover clears it.
    fs.writeFileSync(p('.backups/split-note.lock'), '');
    r = split(['--recover']); assert.equal(r.status, 1); assert.match(r.stderr, /running now; nothing was changed/);
    const old = new Date(Date.now() - 10 * 60000); fs.utimesSync(p('.backups/split-note.lock'), old, old);
    assert.match(run('status').stdout, /INFO \[continuum\] A split lock was left in \.backups\/split-note\.lock \(unreadable\)/);
    r = split(['--recover']); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Cleared a split lock/);
    assert(!fs.existsSync(p('.backups/split-note.lock')));
    same(before, snapshot(), 'lock refusals');
  });
  step('another writer: the run stops, undoes only its own writes, and names the note that changed', () => {
    const before = snapshot();
    // Ticks with one existing target only: 1 lock, 2 and 3 copies, 4 and 5 journal, 6 and 7 the target, 8 and 9 the main note.
    const one = { source: 'Knowledge/Stress.md', notes: [{ title: 'Stress Existing', about: 'Beta', when_to_use: 'x', blocks: ['## Beta'] }] };
    let r = split([planFile(one)], { CONTINUUM_TEST_SPLIT_MEDDLE: '6:Knowledge/Stress.md' });
    assert.equal(r.status, 1); assert.match(r.stderr, /Knowledge\/Stress\.md was changed by something else while the split ran/);
    assert.match(r.stderr, /left as they are now.*Knowledge\/Stress\.md/);
    assert.equal(read('Knowledge/Stress.md'), source + 'written by someone else\n');
    assert(read('Knowledge/Stress Existing.md') === before.get(path.join('Knowledge', 'Stress Existing.md')).toString(), 'the target this run wrote is put back');
    write('Knowledge/Stress.md', source);
    assert.match(split(['--recover', '--resolved']).stdout, /Marked as settled/);
    // The target is changed after this run wrote it: the proof fails, the main note is put back, the target is left and named.
    r = split([planFile(one)], { CONTINUUM_TEST_SPLIT_MEDDLE: '8:Knowledge/Stress Existing.md' });
    assert.equal(r.status, 1); assert.match(r.stderr, /left as they are now.*Knowledge\/Stress Existing\.md/);
    assert.equal(read('Knowledge/Stress.md'), source);
    assert(read('Knowledge/Stress Existing.md').endsWith('written by someone else\n'));
    // Left alone means "needs attention": the lock is released, status and session start keep naming the notes and the copies.
    assert(!fs.existsSync(p('.backups/split-note.lock')));
    for (let k = 0; k < 2; k++) {
      assert.match(run('status').stdout, /FAIL \[continuum\] A note split needs attention: Knowledge\/Stress Existing\.md \(split of Knowledge\/Stress\.md\) were left as they are because something else changed them; compare them with the copies in \.backups\/\d{4}-\d{2}-\d{2}\/\d+-[0-9a-f]{8} with the person\. When they are settled, run node ".*split-note\.js" --recover --resolved\./);
      assert.match(JSON.parse(index().stdout).hookSpecificOutput.additionalContext, /^\[continuum\] A note split needs attention: Knowledge\/Stress Existing\.md/);
      assert.match(split(['--recover']).stdout, /1 split\(s\) still need attention/);
    }
    write('Knowledge/Stress Existing.md', before.get(path.join('Knowledge', 'Stress Existing.md')).toString());
    r = split(['--recover', '--resolved']);
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Marked as settled by the person: the splits of Knowledge\/Stress\.md/);
    assert(!run('status').stdout.includes('needs attention'));
    // A note appears where a new subject note was to be made: the create fails and that file is never deleted.
    const fresh = { source: 'Knowledge/Stress.md', notes: [{ title: 'Stress Fresh', about: 'A', when_to_use: 'x', blocks: ['## Alpha'] }] };
    r = split([planFile(fresh)], { CONTINUUM_TEST_SPLIT_MEDDLE: '7:Knowledge/Stress Fresh.md' });
    assert.equal(r.status, 1); assert.equal(read('Knowledge/Stress Fresh.md'), 'written by someone else\n');
    fs.rmSync(p('Knowledge/Stress Fresh.md'));
    same(before, snapshot(), 'after the other-writer cases');
    assert(!fs.existsSync(p('.backups/split-note.lock')));
  });
  step('recovery trusts nothing it reads: a foreign journal or a copy that does not match its digest is refused', () => {
    const before = snapshot();
    let n = 20;
    for (; n < 60; n++) { // the first kill after the main note was replaced
      const r = split([planFile(plan())], { CONTINUUM_TEST_SPLIT_CRASH: String(n) });
      if (r.status === 70 && read('Knowledge/Stress.md') !== source) break;
      const rc = split(['--recover']); assert.equal(rc.status, 0, 'n=' + n + ' ' + r.status + ' ' + rc.stderr + rc.stdout);
    }
    const lock = JSON.parse(fs.readFileSync(p('.backups/split-note.lock'), 'utf8'));
    const jf = p(lock.journal); const good = fs.readFileSync(jf, 'utf8'); const j = JSON.parse(good);
    const mid = snapshot();
    for (const bad of [{ ...j, vault: outside }, { ...j, dir: '.backups/2026-01-01/other' }, { ...j, source: '../outside.md' }, { ...j, targets: [{ ...j.targets[0], rel: 'Knowledge/../../x.md' }] }]) {
      fs.writeFileSync(jf, JSON.stringify(bad));
      const r = split(['--recover']);
      assert.equal(r.status, 1); assert.match(r.stderr, /is not a journal of this vault .*nothing was restored/);
      same(mid, snapshot(), 'a refused journal changes nothing');
    }
    fs.writeFileSync(jf, good);
    const copy = path.join(vault, ...j.dir.split('/'), 'Knowledge', 'Stress.md'); const original = fs.readFileSync(copy);
    fs.appendFileSync(copy, 'x');
    let r = split(['--recover']);
    assert.equal(r.status, 1); assert.match(r.stderr, /Could not put back Knowledge\/Stress\.md \(its copy .* does not match the digest recorded when it was taken\)/);
    assert.notEqual(read('Knowledge/Stress.md'), source, 'a copy that does not match is not restored');
    assert.match(run('status').stdout, /FAIL \[continuum\] A note split did not finish: Knowledge\/Stress\.md/);
    fs.writeFileSync(copy, original);
    r = split(['--recover']);
    assert.equal(r.status, 0, r.stderr); same(before, snapshot(), 'after the copy was put right');
  });
  step('an existing subject note that is not plain UTF-8 is refused before any write; the dry run says to close the note elsewhere', () => {
    const bytes = Buffer.concat([Buffer.from(fm('odd', 'odd') + '# Odd\n\nCaf'), Buffer.from([0xff]), Buffer.from('\n')]);
    fs.writeFileSync(p('Knowledge/Odd.md'), bytes);
    const before = snapshot();
    const odd = { source: 'Knowledge/Stress.md', notes: [{ title: 'Odd', about: 'o', when_to_use: 'odd', blocks: ['## Alpha'] }] };
    assert.match(split(['--dry-run', planFile(odd)]).stdout, /Subject note Knowledge\/Odd\.md is not plain UTF-8 text/);
    const r = split([planFile(odd)]);
    assert.equal(r.status, 1); assert.match(r.stderr, /not plain UTF-8 text, so entries cannot be added to it exactly/);
    assert(fs.readFileSync(p('Knowledge/Odd.md')).equals(bytes)); same(before, snapshot(), 'non-UTF-8 target');
    fs.rmSync(p('Knowledge/Odd.md'));
    assert.match(split(['--dry-run', planFile(plan())]).stdout, /Close the note in other programs for the few seconds a split runs/);
  });
  step('paths: links, junctions out of the vault, the same file and bad titles are refused', () => {
    fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, 'x.md'), fm('x', 'x') + '## A\n\na\n');
    fs.symlinkSync(outside, p('Knowledge/Out'), 'junction');
    fs.symlinkSync(p('Reference'), p('Knowledge/Inside Link.md'), 'junction');
    const before = snapshot();
    let r = split([planFile({ source: 'Knowledge/Out/x.md', notes: [{ title: 'Y', about: 'y', when_to_use: 'y', blocks: ['## A'] }] })]);
    assert.equal(r.status, 1); assert.match(r.stderr, /resolves outside the vault/);
    for (const title of ['a/b', 'a\\b', '..', 'x..y', 'C:x', 'bad<name', 'CON', 'nul.txt', '.hidden', 'trailing.']) {
      r = split(['--dry-run', planFile({ source: 'Knowledge/Stress.md', notes: [{ title, about: 'y', when_to_use: 'y', blocks: ['## Alpha'] }] })]);
      assert.equal(r.status, 1, title); assert.match(r.stdout, /cannot be a file name/, title);
    }
    r = split(['--dry-run', planFile({ source: 'Knowledge/Stress.md', notes: [{ title: 'Inside Link', about: 'y', when_to_use: 'y', blocks: ['## Alpha'] }] })]);
    assert.match(r.stdout, /Knowledge\/Inside Link\.md is a link/);
    r = split(['--dry-run', planFile({ source: 'Knowledge/Stress.md', notes: [{ title: 'stress', about: 'y', when_to_use: 'y', blocks: ['## Alpha'] }] })]);
    assert.match(r.stdout, /is the source note itself/);
    // The lock and journal folder must be inside the vault too, after links are resolved.
    fs.renameSync(p('.backups'), path.join(temp, 'backups-real'));
    fs.symlinkSync(outside, p('.backups'), 'junction');
    r = split([planFile({ source: 'Knowledge/Stress.md', notes: [{ title: 'Stress Alpha', about: 'y', when_to_use: 'y', blocks: ['## Alpha'] }] })]);
    assert.equal(r.status, 1); assert.match(r.stderr, /Nothing was changed: Path escapes its configured folder/);
    assert.deepEqual(fs.readdirSync(outside), ['x.md']);
    fs.rmSync(p('.backups')); fs.renameSync(path.join(temp, 'backups-real'), p('.backups'));
    fs.rmSync(p('Knowledge/Out')); fs.rmSync(p('Knowledge/Inside Link.md'));
    same(before, snapshot(), 'path refusals');
  });
  step('the proof: exact ranges in source order, a last block without a line break, and a tampered file is caught', () => {
    write('Knowledge/Tail.md', fm('tail', 'tail') + '# Tail\n\n- 2026-03-01: first\n- 2026-03-02: second\n  two\n- 2026-03-03: last, no line break');
    const r = split([planFile({ source: 'Knowledge/Tail.md', notes: [{ title: 'Tail Moved', about: 't', when_to_use: 'tail moved',
      blocks: ['- 2026-03-03: last, no line break', '- 2026-03-01: first'] }] })]);
    assert.equal(r.status, 0, r.stderr);
    assert(read('Knowledge/Tail Moved.md').endsWith('[[Tail]].\n\n- 2026-03-01: first\n- 2026-03-03: last, no line break\n'), 'source order and the one separator');
    assert.match(read('Knowledge/Tail.md'), /# Tail\n\n- 2026-03-02: second\n  two\n\n## Subject notes\n/);
    const C = require('../scripts/lib/config'); const S = require('../scripts/lib/split-plan');
    const c = C.validate(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    write('Knowledge/Tail2.md', '# Tail2\n\n## A\n\na\n\n## B\n\nb\n');
    const plan2 = S.prepare(c, { source: 'Knowledge/Tail2.md', notes: [{ title: 'Tail2 A', about: 'a', when_to_use: 'a', blocks: ['## A'] }] });
    const good = f => (f === plan2.file ? plan2.main : plan2.targets[0].final);
    S.prove(plan2, good);
    assert.throws(() => S.prove(plan2, f => good(f).replace('a\n', 'A\n')), /not hold exactly|not the old note/);
    assert.throws(() => S.prove(plan2, f => (f === plan2.file ? plan2.main.replace('## B', '## B ') : good(f))), /not the old note minus/);
  });
  step('fences: nothing inside a fence (four backticks, tildes) or the frontmatter is a block or the Subject notes section', () => {
    write('Knowledge/Fenced.md', '---\ntype: reference\nnote: x\n---\n# Fenced\n\n````md\n```\n## Fake\n- 2026-04-01: fake entry\n## Subject notes\n```\n````\n\n~~~\n```\n## Tilde fake\n~~~\n\n## Real\n\nreal text\n');
    let r = split(['--dry-run', planFile({ source: 'Knowledge/Fenced.md', notes: [{ title: 'F1', about: 'f', when_to_use: 'f', blocks: ['## Fake', '- 2026-04-01: fake entry', '## Tilde fake'] }] })]);
    assert.match(r.stdout, /"## Fake": not found/); assert.match(r.stdout, /"- 2026-04-01: fake entry": not found/); assert.match(r.stdout, /"## Tilde fake": not found/);
    r = split([planFile({ source: 'Knowledge/Fenced.md', notes: [{ title: 'Fenced Real', about: 'f', when_to_use: 'fenced real', blocks: ['## Real'] }] })]);
    assert.equal(r.status, 0, r.stderr);
    const main = read('Knowledge/Fenced.md');
    assert.equal(main.match(/^## Subject notes$/gm).length, 2, 'the fenced line stays and a real section is added');
    assert(main.includes('````md\n```\n## Fake\n- 2026-04-01: fake entry\n## Subject notes\n```\n````\n') && main.endsWith('- [[Fenced Real]]: f\n'));
  });
  console.log('PASS split-safety: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL split-safety after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
