'use strict';
// Hermes Agent host: the Node side with --host hermes, setup/status/remove for the adapter, and the
// Python adapter driven against a stub Hermes (test/hermes_adapter_test.py), skipped if Python is missing.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const V = require('../scripts/lib/vault');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-hermes-'));
const home = path.join(temp, 'home');
const hermesHome = path.join(temp, 'hermes-home');
const vault = path.join(temp, 'Sample Vault');
const configFile = path.join(home, '.continuum', 'hermes', 'config.json');
const env = { ...process.env, USERPROFILE: home, HOME: home, CLAUDE_CONFIG_DIR: path.join(temp, 'claude'), CODEX_HOME: path.join(temp, 'codex') };
delete env.CONTINUUM_CONFIG; delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
const answers = ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no'];
let checks = 0;
function run(name, args, input, expected = 0) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), '--host', 'hermes', ...args],
    { cwd: root, env, input: input === undefined ? '' : JSON.stringify(input), encoding: 'utf8', timeout: 15000 });
  assert.ifError(r.error); assert.equal(r.status, expected, name + ': ' + r.stderr + r.stdout);
  return r.stdout;
}
const hook = (name, input) => JSON.parse(run(name, [], { session_id: 'h1', transcript_path: null, cwd: vault, ...input }));
const gate = (tool_name, tool_input) => (hook('action-gate', { hook_event_name: 'PreToolUse', tool_name, tool_input }).hookSpecificOutput || {});
const tree = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
const copiesOf = file => tree(path.join(vault, '.backups')).filter(f => path.basename(f) === path.basename(file) &&
  fs.readFileSync(f).equals(fs.readFileSync(file))).length;
const note = (rel, terms, pattern, body) => { fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  fs.writeFileSync(path.join(vault, rel), '---\ntype: reference\npattern: ' + pattern + '\nabout: x\nwhen_to_use: "' + terms +
    '"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\n' + body + '\n'); };
function step(name, fn) { fn(); checks++; console.log('PASS hermes ' + checks + ': ' + name); }
try {
  step('setup --host hermes writes the config, the vault, the adapter and its sidecar, and prints the steps', () => {
    fs.mkdirSync(hermesHome, { recursive: true });
    fs.writeFileSync(path.join(hermesHome, 'config.yaml'), 'model: x\nplugins:\n  enabled:\n    - other\nhooks:\n  output_spill:\n    max_chars: 20000\n');
    const out = run('setup', [...answers, '--hermes-home', hermesHome, '--digests', 'full']);
    assert(fs.existsSync(configFile)); assert(fs.existsSync(path.join(vault, 'START HERE.md')));
    assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).inject.digests, 'full');
    const dest = path.join(hermesHome, 'plugins', 'continuum');
    for (const f of ['__init__.py', 'plugin.yaml', 'continuum.json']) assert(fs.existsSync(path.join(dest, f)), f);
    const side = JSON.parse(fs.readFileSync(path.join(dest, 'continuum.json'), 'utf8'));
    assert.equal(side.root, root); assert.equal(path.resolve(side.config), configFile);
    assert.match(out, /Turn the plugin on/); assert.match(out, /at least 100000 \(it is 20000 now\)/);
    assert.match(out, /Restart the Hermes gateway/); assert.match(out, /What are my standing rules/);
    assert(!fs.existsSync(path.join(home, '.continuum', 'config.json')));
    // A second run moves the old adapter aside (never inside plugins/).
    assert.match(run('setup', [...answers, '--hermes-home', hermesHome]), /kept at .*backups[\\/]plugins[\\/]continuum-/);
    assert.equal(fs.readdirSync(path.join(hermesHome, 'plugins')).join(), 'continuum');
  });
  step('gate on Hermes: ask with a dated copy for a shell delete and an emptying Write; money denied; allow after approve', () => {
    const homeNote = path.join(vault, 'Home.md');
    const shell = gate('Bash', { command: 'Remove-Item -LiteralPath "' + homeNote + '"' });
    assert.equal(shell.permissionDecision, 'ask'); assert.deepEqual(shell.continuumLevels, ['vault-delete']);
    assert.equal(copiesOf(homeNote), 1);
    const write = gate('Write', { file_path: homeNote, content: '' });
    assert.equal(write.permissionDecision, 'ask'); assert.equal(copiesOf(homeNote), 2);
    assert.equal(gate('mcp__commerce__checkout', {}).permissionDecision, 'deny');
    assert.equal(gate('Bash', { command: 'Get-Content "' + homeNote + '" 2>$null' }).permissionDecision, undefined);
    run('approve', ['vault-delete', 'yes you may delete notes']);
    assert.equal(gate('Bash', { command: 'rm "' + homeNote + '"' }).permissionDecision, 'allow');
    assert.equal(copiesOf(homeNote), 3);
    fs.rmSync(path.join(path.dirname(configFile), 'approvals.json'));
  });
  step('archived copies (Reference/History, dot-folders) are not routed, indexed or counted as duplicates', () => {
    note('Reference/History/20261101-0900/Knowledge/Old Gadget.md', 'purple gadget', 'old-gadget', 'ARCHIVED COPY');
    note('.archive/Knowledge/Old Gadget.md', 'purple gadget', 'old-gadget', 'DOT COPY');
    const out = hook('prompt-route', { hook_event_name: 'UserPromptSubmit', prompt: 'the purple gadget' });
    assert(!JSON.stringify(out).includes('ARCHIVED COPY') && !JSON.stringify(out).includes('DOT COPY'));
    hook('session-start', { hook_event_name: 'SessionStart', source: 'startup' });
    assert(!fs.readFileSync(path.join(vault, 'Log', 'index.md'), 'utf8').includes('Old Gadget'));
    assert.equal(gate('Write', { file_path: path.join(vault, 'Knowledge', 'Old Gadget.md'), content: '---\npattern: old-gadget\n---\nNew' }).permissionDecision, undefined);
    // The same file under Knowledge itself is routed (the exclusion is only for archives).
    note('Knowledge/Purple.md', 'purple gadget', 'purple', 'LIVE NOTE');
    assert.match(hook('prompt-route', { hook_event_name: 'UserPromptSubmit', prompt: 'the purple gadget again' }).hookSpecificOutput.additionalContext, /LIVE NOTE/);
  });
  step('inject.digests full injects the newest digest texts; summary keeps one metadata line', () => {
    fs.mkdirSync(path.join(vault, 'Log', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(vault, 'Log', 'sessions', 'old.md'), '---\ntype: session\nabout: "older one"\nupdated: "2026-01-01 00:00"\n---\nOLDER BODY');
    fs.writeFileSync(path.join(vault, 'Log', 'sessions', 'imported.md'), '---\ntype: imported\n---\nIMPORTED BODY');
    const full = hook('session-start', { hook_event_name: 'SessionStart', source: 'startup' }).hookSpecificOutput.additionalContext;
    assert.match(full, /Recent sessions \(full text\)/); assert.match(full, /IMPORTED BODY/); assert.match(full, /OLDER BODY/);
    assert.match(full, /Hermes shows the person its own Yes\/No approval card/); assert.match(full, /--host hermes <level>/);
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8')); delete saved.inject.digests;
    fs.writeFileSync(configFile, JSON.stringify(saved));
    const summary = hook('session-start', { hook_event_name: 'SessionStart', source: 'startup' }).hookSpecificOutput.additionalContext;
    assert.match(summary, /Recent sessions \(metadata only\)/); assert.match(summary, /about: older one/);
    assert(!summary.includes('OLDER BODY') && !summary.includes('IMPORTED BODY'));
    saved.inject.digests = 'bogus'; fs.writeFileSync(configFile, JSON.stringify(saved));
    assert.deepEqual(hook('session-start', { hook_event_name: 'SessionStart' }), {});
    saved.inject.digests = 'summary'; fs.writeFileSync(configFile, JSON.stringify(saved));
    fs.rmSync(path.join(vault, 'Log', 'sessions'), { recursive: true });
  });
  step('standing rules: skeleton layout as before; other layouts load the whole note once; a missing note says so', () => {
    const rulesFile = path.join(vault, 'Knowledge', 'Working Agreements.md');
    const skeleton = fs.readFileSync(rulesFile, 'utf8');
    const start = sid => hook('session-start', { session_id: sid, hook_event_name: 'SessionStart', source: 'startup' }).hookSpecificOutput.additionalContext;
    const plain = start('r0');
    assert.match(plain, /\[continuum\] Standing rules\n\n1\. /); assert(!plain.includes('(The full'));
    fs.writeFileSync(rulesFile, skeleton.replace(/\n---\n[\s\S]*$/, '\n---\n# Working Agreements\n\n## 1. Plan, then ok, then go (Set 2026-11-07)\nPLAN RULE TEXT\n\n## Session learning (x)\nLEARNED\n'));
    const full = start('r1');
    assert.match(full, /\(The full Knowledge\/Working Agreements\.md note follows/);
    assert.match(full, /## 1\. Plan, then ok, then go[\s\S]*PLAN RULE TEXT[\s\S]*LEARNED/);
    assert(!/Standing rules[\s\S]*pattern: working-agreements/.test(full), 'frontmatter stripped');
    const count = () => Number(V.readFm(fs.readFileSync(rulesFile, 'utf8')).times_used);
    const before = count();
    const first = hook('prompt-route', { session_id: 'r1', hook_event_name: 'UserPromptSubmit', prompt: 'show the working agreements' }).hookSpecificOutput.additionalContext;
    assert.match(first, /Working Agreements\.md --- \(already loaded in full/); assert(!first.includes('PLAN RULE TEXT'));
    assert.equal(count(), before + 1);
    const later = hook('prompt-route', { session_id: 'r1', hook_event_name: 'UserPromptSubmit', prompt: 'the working agreements again' }).hookSpecificOutput.additionalContext;
    assert.match(later, /PLAN RULE TEXT/);
    fs.unlinkSync(rulesFile);
    assert.match(start('r2'), /\[continuum\] Standing rules\n\nKnowledge\/Working Agreements\.md was not found/);
    fs.writeFileSync(rulesFile, skeleton);
  });
  step('interpreter one-liners: a read is allowed, a write or delete in the code asks and copies (Claude and Hermes hosts)', () => {
    const target = path.join(vault, 'Knowledge', 'x.md');
    fs.writeFileSync(target, 'one-liner target\n');
    const logText = () => tree(path.join(vault, 'Log')).filter(f => path.basename(f).startsWith('decisions-')).map(f => fs.readFileSync(f, 'utf8')).join('');
    const ask = (host, command) => {
      const args = host === 'hermes' ? ['--host', 'hermes'] : [];
      const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'action-gate.js'), ...args], { cwd: root, encoding: 'utf8',
        env: { ...env, CONTINUUM_CONFIG: configFile }, input: JSON.stringify({ session_id: 'g', transcript_path: null, cwd: vault,
          hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }) });
      return (JSON.parse(r.stdout).hookSpecificOutput || {}).permissionDecision || 'none';
    };
    const cases = [
      ['python -c "from datetime import datetime; print(datetime.now().astimezone().isoformat())"', 'none', false],
      ['python -c "print(open(\'Knowledge/x.md\').read())"', 'none', false],
      ['python -c "open(\'Knowledge/x.md\',\'w\').write(\'\')"', 'ask', true],
      ['python -c "import os; os.remove(\'Knowledge/x.md\')"', 'ask', true],
      ['node -e "console.log(1)"', 'none', false],
      ['node -e "require(\'fs\').rmSync(\'Knowledge/x.md\')"', 'ask', true],
      ['powershell -c "Get-Date"', 'none', false],
      ['powershell -c "Remove-Item Knowledge/x.md"', 'ask', true],
      ['python -c "import os; os.remove(\'' + path.join(temp, 'outside.md').split(path.sep).join('/') + '\')"', 'none', false],
      ['python script.py', 'none', false],
      ['python -c "print(1)" > Knowledge/x.md', 'ask', true]
    ];
    for (const host of ['claude', 'hermes']) {
      for (const [command, want, copied] of cases) {
        const logBefore = logText().split('outcome: asked').length;
        fs.rmSync(path.join(vault, '.backups'), { recursive: true, force: true });
        assert.equal(ask(host, command), want, host + ': ' + command);
        assert.equal(copiesOf(target) > 0, copied, 'copy for ' + host + ': ' + command);
        if (want === 'none') assert.equal(logText().split('outcome: asked').length, logBefore, 'no asked line: ' + command);
      }
    }
    fs.unlinkSync(target);
  });
  step('status --host hermes: read-only lines for adapter, sidecar, version, enabled and spill limit', () => {
    let out = run('status', ['--hermes-home', hermesHome], undefined, 1);
    assert.match(out, /PASS adapter installed/); assert.match(out, /PASS sidecar .* points at scripts that exist/);
    assert.match(out, /PASS adapter version (\S+), package version \1/);
    assert.match(out, /FAIL continuum under plugins: enabled: in config.yaml: no/);
    assert.match(out, /INFO hooks.output_spill.max_chars: 20000/);
    fs.writeFileSync(path.join(hermesHome, 'config.yaml'), 'plugins:\n  enabled: [other, continuum]\n');
    out = run('status', ['--hermes-home', hermesHome]);
    assert.match(out, /PASS continuum under plugins: enabled: in config.yaml: yes/);
    console.log(out.trim().split('\n').map(l => '    ' + l).join('\n'));
  });
  step('the Python adapter, driven like Hermes would against a stub ctx', () => {
    const python = [process.env.CONTINUUM_PYTHON, 'C:\\Python314\\python.exe', 'python3', 'python'].filter(Boolean)
      .find(p => { try { return spawnSync(p, ['--version'], { encoding: 'utf8' }).status === 0; } catch (_) { return false; } });
    if (!python) { console.log('SKIP hermes python: no Python found (set CONTINUUM_PYTHON)'); return; }
    const r = spawnSync(python, ['-I', path.join(root, 'test', 'hermes_adapter_test.py'), hermesHome, vault],
      { env, encoding: 'utf8', timeout: 120000 });
    process.stdout.write(r.stdout.split('\n').filter(Boolean).map(l => '    ' + l).join('\n') + '\n');
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });
  step('--remove moves the adapter aside and leaves vault and config', () => {
    assert.match(run('setup', ['--hermes-home', hermesHome, '--remove']), /moved out of Hermes plugins[\s\S]*left untouched/);
    assert(!fs.existsSync(path.join(hermesHome, 'plugins', 'continuum')));
    assert(fs.existsSync(configFile) && fs.existsSync(path.join(vault, 'START HERE.md')));
  });
  console.log('PASS hermes: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL hermes after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
