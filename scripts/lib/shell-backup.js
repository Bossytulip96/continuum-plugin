'use strict';
// A shell command the gate lets through (Claude Code: "ask" or a valid approval; Codex: a valid
// approval) after classing it vault-delete changes notes with no copy of its own. So every
// existing vault file it names is copied first into one batch: .backups/<date>/<batch>/<path>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./config');

const MAX_FILES = 200;
const MAX_BYTES = 20 * 1024 * 1024;
// Existing vault files the command names: the paths the gate already reads from its text, plus
// PowerShell single-quoted paths with a doubled apostrophe ('Sample''s note.md').
function targets(c, command, cwd, commandPaths) {
  const named = commandPaths(c, command, cwd).filter(t => !t.wide).map(t => t.p);
  const rx = /'((?:[^']|'')+)'/g;
  let m;
  while ((m = rx.exec(command))) {
    if (m[1].includes("''")) { try { named.push(C.resolveTarget(c, m[1].replace(/''/g, "'"), cwd)); } catch (_) { /* not a path */ } }
  }
  const copies = C.vaultPath(c, '.backups');
  const files = new Set();
  let bytes = 0;
  function add(p) {
    if (C.covers(copies, p)) return;
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { for (const name of fs.readdirSync(p).sort()) add(path.join(p, name)); return; }
    if (!st.isFile() || files.has(p)) return;
    files.add(p); bytes += st.size;
    if (files.size > MAX_FILES || bytes > MAX_BYTES) {
      throw new Error('the command names more than ' + MAX_FILES + ' files or 20 MB in the vault');
    }
  }
  for (const p of new Set(named)) {
    if (C.covers(c.vault, p) && fs.existsSync(p)) add(p);
  }
  return [...files];
}
// Returns a deny when the copy cannot be made, otherwise null (and the copy exists).
function shellGuard(c, call, input, willRun, h) {
  if (!willRun || !call.shell || !call.levels.includes('vault-delete')) return null;
  const area = 'action: ' + call.tool;
  try {
    const files = targets(c, call.command, input.cwd, h.commandPaths);
    if (!files.length) return null;
    const batch = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    for (const file of files) h.backup(c, file, batch);
    h.note(c, area, 'vault-delete', 'backed up ' + files.length + ' file(s) before the command',
      ['.backups', C.date(c), batch].join('/'));
    return null;
  } catch (e) {
    h.note(c, area, 'vault-delete', 'denied, backup failed', String(e.message || e));
    return h.decision('deny', '[continuum] The backup of the vault files this command names failed (' +
      (e.message || e) + '), so the command is refused.');
  }
}
// True when the approved retry of this command will copy what it names (a wildcard path names no file).
function copyable(c, command, cwd, commandPaths) {
  try { return targets(c, command, cwd, commandPaths).length > 0; } catch (_) { return false; }
}
module.exports = { shellGuard, targets, copyable, MAX_FILES, MAX_BYTES };
