'use strict';
// One-step Codex install: setup --host codex writes config, vault, hooks file and AGENTS.md;
// --hooks user/none, merging with foreign hooks, --remove, and the read-only status check.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-codexsetup-'));
const home = path.join(temp, 'home');
const codexHome = path.join(temp, 'codex-home');
const vault = path.join(temp, 'My Vault');
const env = { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: path.join(temp, 'claude') };
delete env.CONTINUUM_CONFIG; delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
const answers = ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no'];
const projectHooks = path.join(vault, '.codex', 'hooks.json');
const userHooks = path.join(codexHome, 'hooks.json');
let checks = 0;
function run(name, args, expected = 0, input = '') {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), '--host', 'codex', ...args],
    { cwd: root, env, input, encoding: 'utf8', timeout: 15000 });
  assert.ifError(r.error); assert.equal(r.status, expected, r.stderr + r.stdout);
  return r.stdout;
}
const commands = file => Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).flatMap(gs => gs.flatMap(g => g.hooks.map(h => h.command)));
const foreign = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other-stop' }] }],
  PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other-gate' }] }] } };
function step(name, fn) { fn(); checks++; console.log('PASS codex-setup ' + checks + ': ' + name); }
try {
  step('fresh install writes config, skeleton, hooks.json with absolute forward-slash paths, AGENTS.md and the five steps', () => {
    const out = run('setup', answers);
    assert(fs.existsSync(path.join(home, '.continuum', 'codex', 'config.json')));
    assert(fs.existsSync(path.join(vault, 'START HERE.md')));
    const data = JSON.parse(fs.readFileSync(projectHooks, 'utf8'));
    assert.equal(data.description, undefined);
    const cmds = commands(projectHooks);
    assert.equal(cmds.length, 6);
    for (const cmd of cmds) {
      const script = cmd.match(/^node "([^"]+)" --host codex$/)[1];
      assert(!script.includes('\\') && !script.includes('${'));
      assert(fs.existsSync(script)); assert(script.startsWith(root.split(path.sep).join('/') + '/scripts/'));
    }
    const agents = fs.readFileSync(path.join(vault, 'AGENTS.md'), 'utf8');
    assert.match(agents, /^---\r?\ntype: reference/); assert.match(agents, /\[continuum\]/); assert.match(agents, /^F\. /m);
    assert(agents.split('\n').length < 60); assert(agents.includes('Sample Person'));
    assert(agents.includes('To delete, move or empty a note, run one plain command that does only that'));
    assert(agents.includes('When the hooks ran, do not do the fallback steps below by hand.'));
    assert.match(out, /Codex hooks written/); assert.match(out, /^5\. Ask "What are my standing rules\?"/m);
    assert(!fs.existsSync(userHooks));
  });
  step('the generated hook command really runs: SessionStart stdin gives context back', () => {
    const cmd = commands(projectHooks).find(c => c.includes('session-start.js'));
    const r = spawnSync(cmd, { shell: true, cwd: vault, env, encoding: 'utf8', timeout: 15000, input: JSON.stringify({
      session_id: 'thr_live', transcript_path: path.join(temp, 'rollout.jsonl'), cwd: vault, hook_event_name: 'SessionStart', source: 'startup' }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /# START HERE/);
  });
  step('a second run changes no byte of hooks.json or AGENTS.md', () => {
    const before = fs.readFileSync(projectHooks); const agents = fs.readFileSync(path.join(vault, 'AGENTS.md'));
    assert.match(run('setup', answers), /unchanged.*trust is kept/);
    assert(fs.readFileSync(projectHooks).equals(before)); assert(fs.readFileSync(path.join(vault, 'AGENTS.md')).equals(agents));
    assert.equal(fs.readdirSync(path.dirname(projectHooks)).length, 1);
  });
  step('an existing foreign hooks.json is backed up and merged; Continuum entries are replaced, not doubled', () => {
    const mine = JSON.parse(fs.readFileSync(projectHooks, 'utf8'));
    mine.hooks.Stop.push(...foreign.hooks.Stop); mine.hooks.PreToolUse.push(...foreign.hooks.PreToolUse);
    const before = JSON.stringify(mine);
    fs.writeFileSync(projectHooks, before);
    assert.match(run('setup', answers), /merged; 2 other hook\(s\) kept[\s\S]*Trust them again/);
    const cmds = commands(projectHooks);
    assert.equal(cmds.length, 8); assert(cmds.includes('echo other-stop') && cmds.includes('echo other-gate'));
    const copies = fs.readdirSync(path.dirname(projectHooks)).filter(f => f.startsWith('hooks.json.bak-'));
    assert.equal(copies.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(projectHooks), copies[0]), 'utf8'), before);
  });
  step('--remove takes out only Continuum entries; vault and config stay', () => {
    const out = run('setup', ['--remove']);
    assert.match(out, /other hooks kept/); assert.match(out, /vault and the config are left untouched/);
    assert.deepEqual(commands(projectHooks).sort(), ['echo other-gate', 'echo other-stop']);
    assert(fs.existsSync(path.join(vault, 'START HERE.md')) && fs.existsSync(path.join(home, '.continuum', 'codex', 'config.json')));
    // A file that held only Continuum's hooks is deleted on --remove (a copy is kept).
    fs.rmSync(path.dirname(projectHooks), { recursive: true });
    run('setup', answers);
    assert.match(run('setup', ['--remove']), /held only Continuum hooks/);
    assert(!fs.existsSync(projectHooks));
  });
  step('--hooks user writes under CODEX_HOME with a warning; --hooks none writes none', () => {
    assert.match(run('setup', [...answers, '--hooks', 'user']), /Warning: hooks in .* run in every local Codex chat/);
    assert.equal(commands(userHooks).length, 6); assert(!fs.existsSync(projectHooks));
    fs.rmSync(userHooks);
    assert.match(run('setup', [...answers, '--hooks', 'none']), /No Codex hooks file written/);
    assert(!fs.existsSync(userHooks) && !fs.existsSync(projectHooks));
    run('setup', [...answers, '--hooks', 'bogus'], 1);
  });
  step('status: read-only PASS/FAIL lines and trusted yes / no / cannot tell from config.toml', () => {
    run('setup', answers);
    const snapshot = () => [projectHooks, path.join(home, '.continuum', 'codex', 'config.json')].map(f => fs.readFileSync(f, 'utf8')).join('|');
    const before = snapshot();
    let out = run('status', []);
    assert.match(out, /PASS config found/); assert.match(out, /PASS vault folder/); assert.match(out, /every script exists/);
    assert.match(out, /INFO hooks trusted in Codex: cannot tell/);
    fs.mkdirSync(codexHome, { recursive: true });
    const key = (event, i) => "[hooks.state.'" + projectHooks + ':' + event + ':' + i + ":0']\ntrusted_hash = \"x\"\n";
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "m"\n' + key('SessionStart', 0));
    out = run('status', [], 1);
    assert.match(out, /FAIL hooks trusted in Codex: no \(1 of 6\)/);
    fs.writeFileSync(path.join(codexHome, 'config.toml'), ['SessionStart', 'UserPromptSubmit', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'SessionEnd']
      .map((e, n) => key(e, n === 2 ? 1 : 0)).join('\n'));
    out = run('status', []);
    assert.match(out, /PASS hooks trusted in Codex: yes/);
    assert.equal(snapshot(), before);
    console.log(out.trim().split('\n').map(l => '    ' + l).join('\n'));
  });
  console.log('PASS codex-setup: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL codex-setup after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
