'use strict';
// Shell commands that delete vault files: a dated copy exists before the gate lets one run,
// on both hosts; no copy on a plain deny; a copy that cannot be made turns into a deny.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-shellcopy-'));
const vault = path.join(temp, 'Sample Vault');
const config = path.join(temp, 'config', 'config.json');
const env = { ...process.env, CONTINUUM_CONFIG: config, CLAUDE_CONFIG_DIR: path.join(temp, 'claude') };
delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
let checks = 0;
function run(name, args, input) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), ...args], {
    cwd: root, env, input: input === undefined ? '' : JSON.stringify(input), encoding: 'utf8', timeout: 8000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr + r.stdout);
  return r;
}
function answer(host, tool_name, command, cwd = vault) {
  const args = host === 'codex' ? ['--host', 'codex'] : [];
  return JSON.parse(run('action-gate', args, { session_id: 's', transcript_path: path.join(temp, 'rollout.jsonl'),
    cwd, hook_event_name: 'PreToolUse', tool_name, tool_input: { command } }).stdout).hookSpecificOutput || {};
}
const gate = (...args) => answer(...args).permissionDecision || 'none';
const tree = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
const copies = () => tree(path.join(vault, '.backups'));
const copiesOf = file => copies().filter(f => path.basename(f) === path.basename(file) &&
  fs.readFileSync(f).equals(fs.readFileSync(file)));
const reset = () => { fs.rmSync(path.join(vault, '.backups'), { recursive: true, force: true });
  fs.rmSync(path.join(temp, 'config', 'approvals.json'), { force: true }); };
function step(name, fn) { reset(); fn(); checks++; console.log('PASS shell-backup ' + checks + ': ' + name); }
try {
  run('setup', ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC',
    '--autonomy', 'ask', '--allow-folder', 'no']);
  const odd = path.join(vault, 'notes-and-ideas', "Sample's Gate test note.md");
  fs.mkdirSync(path.dirname(odd), { recursive: true });
  fs.writeFileSync(odd, Buffer.from('---\ntype: idea\n---\nbytes é kept\r\n', 'utf8'));
  const approve = host => run('approve', [...(host === 'codex' ? ['--host', 'codex'] : []), 'vault-delete', 'yes delete it']);
  step('Codex: PowerShell variable form, name with a space and an apostrophe', () => {
    const ps = "$note = '" + odd.split(path.sep).join('/').replace(/'/g, "''") + "'\nRemove-Item -LiteralPath $note -ErrorAction Stop\nTest-Path -LiteralPath $note";
    assert.equal(gate('codex', 'Bash', ps), 'deny'); assert.equal(copies().length, 0);
    approve('codex');
    assert.equal(gate('codex', 'Bash', ps), 'none'); assert.equal(copiesOf(odd).length, 1);
    const log = tree(path.join(vault, 'Log')).filter(f => path.basename(f).startsWith('decisions-')).map(f => fs.readFileSync(f, 'utf8')).join('');
    assert.match(log, /backed up 1 file\(s\) before the command \| \.backups\/\d{4}-\d{2}-\d{2}\/\d+-[0-9a-f]{8}/);
  });
  step('Codex: sh form rm "<path>" and a double-quoted PowerShell path', () => {
    const sh = 'rm "' + odd.split(path.sep).join('/') + '"';
    assert.equal(gate('codex', 'Bash', sh), 'deny'); assert.equal(copies().length, 0);
    approve('codex');
    assert.equal(gate('codex', 'Bash', sh), 'none'); assert.equal(copiesOf(odd).length, 1);
    assert.equal(gate('codex', 'Bash', 'Remove-Item -LiteralPath "' + odd + '"'), 'none'); assert.equal(copiesOf(odd).length, 2);
  });
  step('Codex: one plain delete of a note is a vault-delete ask (not system-change), the reason says no copy of its own, the retry copies', () => {
    const cmd = "Remove-Item -LiteralPath '" + odd.replace(/'/g, "''") + "'";
    const first = answer('codex', 'Bash', cmd);
    assert.equal(first.permissionDecision, 'deny'); assert(first.permissionDecisionReason.startsWith('[continuum] Stopped, not run. vault-delete: '));
    assert(!/system-change/.test(first.permissionDecisionReason)); assert.equal(copies().length, 0);
    assert(first.permissionDecisionReason.endsWith('Continuum keeps its own dated copy under .backups; make none yourself. After the yes, run the approve line alone, then the same plain command again, alone.'));
    approve('codex');
    assert.equal(gate('codex', 'Bash', cmd), 'none'); assert.equal(copiesOf(odd).length, 1);
    reset(); // A wildcard names no file, so no copy is made and the reason does not promise one.
    assert(!answer('codex', 'Bash', "Remove-Item '" + path.join(path.dirname(odd), '*.md') + "'").permissionDecisionReason.includes('dated copy'));
  });
  step('Claude Code: Bash rm and PowerShell Remove-Item answer ask and the copy exists', () => {
    assert.equal(gate('claude', 'Bash', 'rm "' + odd.split(path.sep).join('/') + '"'), 'ask');
    assert.equal(copiesOf(odd).length, 1);
    assert.equal(gate('claude', 'PowerShell', "Remove-Item 'notes-and-ideas/" + path.basename(odd).replace(/'/g, "''") + "'"), 'ask');
    assert.equal(copiesOf(odd).length, 2);
    approve('claude');
    assert.equal(gate('claude', 'Bash', 'rm "' + odd + '"'), 'allow'); assert.equal(copiesOf(odd).length, 3);
    // Reads and paths that do not exist copy nothing.
    assert.equal(gate('claude', 'Bash', 'cat "' + odd + '"'), 'none');
    reset();
    assert.equal(gate('claude', 'Bash', 'rm "' + path.join(vault, 'absent.md') + '"'), 'ask'); assert.equal(copies().length, 0);
  });
  step('a directory target copies the files under it', () => {
    assert.equal(gate('claude', 'PowerShell', 'Remove-Item -Recurse "' + path.dirname(odd) + '"'), 'ask');
    const all = tree(path.dirname(odd));
    assert(all.length >= 1);
    for (const f of all) assert.equal(copiesOf(f).length, 1, f);
  });
  step('a copy that cannot be made, or a target over the cap, is a deny', () => {
    fs.writeFileSync(path.join(vault, '.backups'), 'not a folder');
    assert.equal(gate('claude', 'Bash', 'rm "' + odd + '"'), 'deny');
    approve('codex');
    assert.equal(gate('codex', 'Bash', 'rm "' + odd + '"'), 'deny');
    fs.rmSync(path.join(vault, '.backups'));
    const big = path.join(vault, 'bulk');
    fs.mkdirSync(big);
    for (let i = 0; i < 201; i++) fs.writeFileSync(path.join(big, 'n' + i + '.md'), 'x');
    assert.equal(gate('claude', 'Bash', 'rm -r "' + big + '"'), 'deny'); assert.equal(copies().length, 0);
    assert(fs.existsSync(odd));
  });
  console.log('PASS shell-backup: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL shell-backup after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
