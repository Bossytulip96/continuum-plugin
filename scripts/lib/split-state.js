'use strict';
// The state a real split leaves in .backups: the lock (one run or recovery at a time), the journal it names, and
// the list of splits that need the person's attention. Reading here never trusts what it reads: a journal must be
// this vault's, name its own batch folder and only paths inside the vault.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const YOUNG_MS = 2 * 60 * 1000; // an unreadable or empty lock younger than this may be a run that is writing it
const lockFile = c => C.vaultPath(c, '.backups', 'split-note.lock');
const attentionFile = c => C.vaultPath(c, '.backups', 'split-attention.json');
const plain = message => Object.assign(new Error(message), { plain: true });
const command = mode => require('./filing').command(mode);
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function readLock(c) {
  const file = lockFile(c); // throws when .backups leads out of the vault through a link
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let lock = null;
  try { lock = JSON.parse(raw); } catch (_) { /* half written or damaged */ }
  let age = 0;
  try { age = Date.now() - fs.statSync(file).mtimeMs; } catch (_) { /* gone meanwhile */ }
  return { raw, lock: lock && typeof lock === 'object' ? lock : null, age };
}
// The journal named by a lock or the attention list, checked: this vault, its own batch folder, paths inside the vault.
function readJournal(c, rel) {
  const where = String(rel || '');
  let file;
  try { file = C.vaultPath(c, where); } catch (_) { throw plain('The journal path ' + where + ' leads outside the vault; nothing was restored.'); }
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw plain('The journal ' + where + ' cannot be read (' + e.message + '); nothing was restored.'); }
  const hex = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const inVault = r => { try { return typeof r === 'string' && /\.md$/i.test(r) && !r.split('/').some(s => s.startsWith('.')) && Boolean(C.vaultPath(c, r)); } catch (_) { return false; } };
  const same = (a, b) => path.resolve(C.normalize(a)).toLowerCase() === path.resolve(C.normalize(b)).toLowerCase();
  const ok = j && typeof j === 'object' && typeof j.vault === 'string' && same(j.vault, c.vault) &&
    /^\d+-[0-9a-f]{8}$/.test(j.batch) && new RegExp('^\\.backups/\\d{4}-\\d{2}-\\d{2}/' + j.batch + '$').test(j.dir) &&
    j.journal === j.dir + '/split-journal.json' && j.journal === where && inVault(j.source) && hex(j.sourceSha) && hex(j.mainSha) &&
    Array.isArray(j.made) && Array.isArray(j.targets) && j.targets.every(t => t && inVault(t.rel) && hex(t.sha) && (t.created || hex(t.beforeSha)));
  if (!ok) throw plain('The journal ' + where + ' is not a journal of this vault (another vault, another folder, or a path outside the vault); nothing was restored.');
  return j;
}
// null, or what the lock means: live (a run or recovery may be under way), running (a split did not finish), lock (left over).
function lockStatus(c) {
  const l = readLock(c);
  if (!l) return null;
  if (!l.lock) return l.age < YOUNG_MS ? { kind: 'live', raw: l.raw, lock: {} } : { kind: 'lock', raw: l.raw, lock: {} };
  if (alive(Number(l.lock.pid))) return { kind: 'live', raw: l.raw, lock: l.lock };
  let journal = null;
  try { journal = readJournal(c, l.lock.journal); } catch (e) {
    // A journal that is there but cannot be trusted is never taken for "nothing was written": it stays unfinished.
    let there = false;
    try { there = fs.existsSync(C.vaultPath(c, String(l.lock.journal || ''))); } catch (_) { there = true; }
    if (there) return { kind: 'running', raw: l.raw, lock: l.lock, journal: { source: String(l.lock.journal) + ' (journal cannot be trusted)' }, bad: e };
  }
  if (journal && journal.state === 'running') return { kind: 'running', raw: l.raw, lock: l.lock, journal };
  return { kind: 'lock', raw: l.raw, lock: l.lock };
}
// Taken exclusively, written and flushed before any other step; a reader sees it empty at most for that moment.
function takeLock(c, fields) {
  const file = lockFile(c);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx');
  try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, started: Date.now(), ...fields }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
// A recovery takes over a lock it judged left over, only if the lock still holds the very bytes it judged.
function takeOver(c, seen, fields) {
  const now = readLock(c);
  if (now && now.raw !== seen) throw plain('The split lock changed while it was being checked; another run may have started. Nothing was changed.');
  if (now) fs.unlinkSync(lockFile(c));
  takeLock(c, fields);
}
function releaseLock(c) {
  const l = readLock(c);
  if (l && l.lock && l.lock.pid === process.pid) fs.unlinkSync(lockFile(c));
}
function writeAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, text, { flag: 'wx' }); fs.renameSync(tmp, file);
}
function attention(c) {
  try { const list = JSON.parse(fs.readFileSync(attentionFile(c), 'utf8')); return Array.isArray(list) ? list.filter(r => typeof r === 'string') : []; }
  catch (e) { return e.code === 'ENOENT' ? [] : ['(the list .backups/split-attention.json cannot be read)']; }
}
const setAttention = (c, list) => writeAtomic(attentionFile(c), JSON.stringify([...new Set(list)], null, 1) + '\n');
// The [continuum] lines status and session start show: an unfinished split, a left-over lock, splits that need attention.
function lines(c) {
  const out = [];
  const s = lockStatus(c);
  if (s && s.kind === 'running') {
    out.push({ fail: true, text: '[continuum] A note split did not finish: ' + s.journal.source + '. Before anything else run ' + command('--recover') +
      ' to put the notes back as they were, then tell the person what it says.' });
  } else if (s && s.kind === 'lock') {
    out.push({ fail: false, text: '[continuum] A split lock was left in .backups/split-note.lock (' + (s.lock.started ? 'from ' + new Date(s.lock.started).toISOString() : 'unreadable') +
      ') and no split is running under it. Tell the person; ' + command('--recover') + ' clears it.' });
  }
  for (const rel of attention(c)) {
    let j = null;
    try { j = readJournal(c, rel); } catch (_) { /* reported below as it is */ }
    if (j && j.state !== 'needs attention') continue;
    out.push({ fail: true, text: '[continuum] A note split needs attention: ' + (j ? (j.left || []).map(x => x.rel).join(', ') + ' (split of ' + j.source +
      ') were left as they are because something else changed them; compare them with the copies in ' + j.dir : rel + ' cannot be read') +
      ' with the person. When they are settled, run ' + command('--recover --resolved') + '.' });
  }
  return out;
}
module.exports = { YOUNG_MS, lockFile, attentionFile, alive, readLock, readJournal, lockStatus, takeLock, takeOver, releaseLock, writeAtomic, attention, setAttention, lines };
