'use strict';
// Codex host cases. Every hook runs as a real child process with --host codex, the way
// hooks/codex-hooks.json starts it, against a throwaway home folder and vault.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const V = require('../scripts/lib/vault');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-codex-'));
const home = path.join(temp, 'home');
const vault = path.join(temp, 'vault');
const configDir = path.join(home, '.continuum', 'codex');
const env = { ...process.env, USERPROFILE: home, HOME: home, CODEX_HOME: path.join(temp, 'codex-home'), CLAUDE_CONFIG_DIR: path.join(temp, 'claude') };
delete env.CONTINUUM_CONFIG; delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
const events = { 'session-start': 'SessionStart', 'prompt-route': 'UserPromptSubmit', 'action-gate': 'PreToolUse' };
const UNSUPPORTED = ['continue', 'stopReason', 'suppressOutput'];
let checks = 0;
// Real chats always carry a rollout path; the app's background sessions carry null.
const ROLLOUT = path.join(temp, 'rollout-sample.jsonl');
function run(name, args = [], input, environment = env) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), ...args], {
    cwd: root, env: environment, input: input === undefined ? '' : JSON.stringify(input && !('transcript_path' in input) ? { transcript_path: ROLLOUT, ...input } : input), encoding: 'utf8', timeout: 8000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, name + ': ' + result.stderr + result.stdout);
  return result;
}
// A Codex hook input as the docs describe it: common fields plus the event's own.
function hook(name, extra = {}, environment = env) {
  const input = { session_id: 'thr_main', transcript_path: ROLLOUT, cwd: vault, model: 'sample-model',
    permission_mode: 'default', hook_event_name: events[name], turn_id: 'turn-1', ...extra };
  const result = run(name, ['--host', 'codex'], input, environment);
  const output = JSON.parse(result.stdout);
  for (const field of UNSUPPORTED) assert(!(field in output), name + ' returned unsupported ' + field);
  return output;
}
const gate = (tool_name, tool_input, extra) => hook('action-gate', { tool_name, tool_input, tool_use_id: 'call-1', ...extra });
function denied(output, level) {
  const h = output.hookSpecificOutput || {};
  assert.equal(h.permissionDecision, 'deny', 'expected deny (' + level + '): ' + JSON.stringify(output));
  assert.match(h.permissionDecisionReason, new RegExp(level));
  if (level !== 'money') {
    assert(h.permissionDecisionReason.includes('node "' + path.join(root, 'scripts', 'approve.js') + '" --host codex ' + level));
    assert.match(h.permissionDecisionReason, /yes or no question/);
  }
}
const allowed = output => assert.deepEqual(output, {}, 'expected no decision: ' + JSON.stringify(output));
const patch = (...ops) => ({ command: ['*** Begin Patch', ...ops, '*** End Patch'].join('\n') });
const note = (rel, terms, pattern) => {
  fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  fs.writeFileSync(path.join(vault, rel), '---\ntype: reference\npattern: ' + pattern + '\nabout: x\nwhen_to_use: "' + terms +
    '"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\n# Fixture\nCODEX BODY\n');
};
const tree = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
function step(name, fn) { fn(); checks++; console.log('PASS codex ' + checks + ': ' + name); }
try {
  step('setup with --host codex writes its own config folder, not the Claude Code one', () => {
    const out = run('setup', ['--host', 'codex', '--person', 'Sample Person', '--vault', vault, '--machine', 'sample',
      '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no']).stdout;
    assert(out.includes(path.join(configDir, 'config.json')));
    assert(fs.existsSync(path.join(configDir, 'config.json')));
    assert(!fs.existsSync(path.join(home, '.continuum', 'config.json')));
    // Without the flag the Claude Code default is unchanged: no config there, so the hook is silent.
    const plain = spawnSync(process.execPath, [path.join(root, 'scripts', 'session-start.js')], { env, input: '{}', encoding: 'utf8' });
    assert.deepEqual(JSON.parse(plain.stdout), {}); assert.match(plain.stderr, /continuum-setup/);
  });
  step('SessionStart returns additionalContext with the Codex approve line', () => {
    const out = hook('session-start', { source: 'startup' }).hookSpecificOutput;
    assert.equal(out.hookEventName, 'SessionStart');
    assert.match(out.additionalContext, /# START HERE/);
    assert(out.additionalContext.includes('node "' + path.join(root, 'scripts', 'approve.js') + '" --host codex <level>'));
    assert(out.additionalContext.includes('To delete, move or empty a note in the notes folder, run one plain command that does only that'));
    assert(out.additionalContext.includes('Never ask the person to approve system-change for a note delete'));
  });
  step('UserPromptSubmit fired three times by side sessions counts once and injects every time', () => {
    note('Knowledge/Codex Topic.md', 'green gadget', 'codex-topic');
    for (const sid of ['thr_main', 'thr_side1', 'thr_side2']) {
      const out = hook('prompt-route', { session_id: sid, prompt: "that's wrong, the green gadget again" });
      assert.match(out.hookSpecificOutput.additionalContext, /CODEX BODY/);
    }
    assert.equal(V.readFm(fs.readFileSync(path.join(vault, 'Knowledge', 'Codex Topic.md'), 'utf8')).times_used, '1');
    const logs = tree(path.join(vault, 'Log')).filter(f => path.basename(f).startsWith('decisions-'));
    assert.equal(logs.map(f => fs.readFileSync(f, 'utf8')).join('').split('correction (candidate)').length, 2);
    // A new message with other text counts again; a stale claim of the same text is taken over.
    hook('prompt-route', { prompt: 'green gadget please' });
    assert.equal(V.readFm(fs.readFileSync(path.join(vault, 'Knowledge', 'Codex Topic.md'), 'utf8')).times_used, '2');
    process.env.CONTINUUM_CONFIG = path.join(configDir, 'config.json');
    const c = require('../scripts/lib/config').load();
    const X = require('../scripts/lib/codex');
    assert.equal(X.claim(c, 'green gadget please'), false);
    assert.equal(X.claim(c, 'green gadget please', Date.now() + X.DEDUPE_MS + 1000), true);
    delete process.env.CONTINUUM_CONFIG;
  });
  const homeNote = path.join(vault, 'Home.md');
  step('Bash (PowerShell and sh syntax) deleting a vault note is denied with chat instructions', () => {
    denied(gate('Bash', { command: 'Remove-Item -LiteralPath "' + homeNote + '"' }), 'vault-delete');
    denied(gate('Bash', { command: 'rm "' + homeNote.split(path.sep).join('/') + '"' }), 'vault-delete');
    denied(gate('Bash', { command: 'del Home.md' }), 'vault-delete');
    allowed(gate('Bash', { command: 'Get-Content "' + homeNote + '" 2>$null' }));
    allowed(gate('Bash', { command: 'Get-ChildItem "' + vault + '"' }));
    denied(gate('Bash', { command: 'Set-Content "' + path.join(home, '.codex', 'config.toml') + '" x' }), 'system-change');
  });
  step('apply_patch: Update backs up, Delete and Move are vault-delete, Add checks duplicates', () => {
    const before = fs.readFileSync(homeNote, 'utf8');
    allowed(gate('apply_patch', patch('*** Update File: ' + homeNote, '@@', '-x', '+y')));
    assert(tree(path.join(vault, '.backups')).some(f => fs.readFileSync(f, 'utf8') === before));
    denied(gate('apply_patch', patch('*** Delete File: Home.md')), 'vault-delete');
    denied(gate('apply_patch', patch('*** Update File: Home.md', '*** Move to: Archive/Home.md', '@@', '-a', '+b')), 'vault-delete');
    denied(gate('apply_patch', patch('*** Add File: Knowledge/Copies/Codex Topic.md', '+---', '+pattern: other', '+---', '+Same title')), 'new-note');
    denied(gate('apply_patch', patch('*** Add File: Knowledge/Alias.md', '+---', '+pattern: codex-topic', '+---', '+Same pattern')), 'new-note');
    allowed(gate('apply_patch', patch('*** Add File: Knowledge/Fresh Idea.md', '+---', '+pattern: fresh-idea', '+---', '+New')));
    allowed(gate('apply_patch', patch('*** Delete File: ' + path.join(temp, 'elsewhere.md'))));
    denied(gate('apply_patch', patch('*** Update File: ' + path.join(home, '.codex', 'hooks.json'), '@@', '-a', '+b')), 'system-change');
  });
  step('approved retry: the exact approve line passes the gate, records the words, then the retry runs', () => {
    const reason = gate('apply_patch', patch('*** Delete File: Home.md')).hookSpecificOutput.permissionDecisionReason;
    const line = reason.match(/node "[^"]+" --host codex vault-delete "<their words>"/)[0].replace('<their words>', 'yes delete Home.md');
    allowed(gate('Bash', { command: line }));
    const script = line.match(/^node "([^"]+)"/)[1];
    assert.equal(script, path.join(root, 'scripts', 'approve.js'));
    run('approve', ['--host', 'codex', 'vault-delete', 'yes delete Home.md']);
    const approvals = JSON.parse(fs.readFileSync(path.join(configDir, 'approvals.json'), 'utf8'));
    assert.equal(approvals['vault-delete'].note, 'yes delete Home.md');
    assert(!fs.existsSync(path.join(home, '.continuum', 'approvals.json')));
    allowed(gate('apply_patch', patch('*** Delete File: Home.md')));
    allowed(gate('Bash', { command: 'Remove-Item "' + homeNote + '"' }));
  });
  step('money is denied outright and never approvable', () => {
    denied(gate('mcp__commerce__checkout', {}), 'money');
    denied(gate('mcp__x__send_mail', {}), 'email-send');
    allowed(gate('mcp__x__list_records', {}));
  });
  step('background sessions (suggested message fork, memory writer) get nothing and write nothing; the gate still denies', () => {
    const topic = path.join(vault, 'Knowledge', 'Codex Topic.md');
    const logText = () => tree(path.join(vault, 'Log')).filter(f => path.basename(f).startsWith('decisions-'))
      .map(f => fs.readFileSync(f, 'utf8')).join('');
    fs.rmSync(path.join(configDir, 'approvals.json'), { force: true }); // the earlier yes must not cover these
    const counted = V.readFm(fs.readFileSync(topic, 'utf8')).times_used;
    const logBefore = logText();
    const index = path.join(vault, 'Log', 'index.md');
    fs.writeFileSync(index, 'SENTINEL');
    const statesBefore = tree(path.join(configDir, 'codex-sessions')).length;
    const fork = { session_id: 'thr_fork', transcript_path: null, cwd: vault };
    const memory = { session_id: 'thr_mem', transcript_path: null, cwd: path.join(home, '.codex', 'memories'),
      model: 'sample-model', permission_mode: 'bypassPermissions' };
    const suggest = "This is an app-generated request for a suggested next user message. that's wrong, green gadget";
    const writer = "## Memory Writing Agent\nthat's wrong, green gadget";
    for (const [bg, prompt] of [[fork, suggest], [memory, writer]]) {
      assert.deepEqual(hook('session-start', { ...bg, source: bg === fork ? 'fork' : 'startup' }), {});
      assert.deepEqual(hook('prompt-route', { ...bg, prompt }), {});
      for (const event of ['UserPromptSubmit', 'Stop', 'SessionEnd']) {
        assert.equal(run('session-digest', ['--host', 'codex'], { ...bg, hook_event_name: event, prompt,
          last_assistant_message: 'background reply', reason: 'other' }).stdout.trim(), '{}');
      }
      // The memory writer runs in another folder, so the vault note is named by its full path.
      denied(gate('apply_patch', patch('*** Delete File: ' + homeNote), bg), 'vault-delete');
      denied(gate('Bash', { command: 'Remove-Item "' + homeNote + '"' }, bg), 'vault-delete');
    }
    // A fork start is background even with a transcript; so is a known prompt opening.
    assert.deepEqual(hook('session-start', { source: 'fork' }), {});
    assert.deepEqual(hook('prompt-route', { session_id: 'thr_x', prompt: 'Consolidate the supplied rollout summaries: green gadget' }), {});
    assert.equal(V.readFm(fs.readFileSync(topic, 'utf8')).times_used, counted);
    assert.equal(logText().split('correction (candidate)').length, logBefore.split('correction (candidate)').length);
    assert.equal(fs.readFileSync(index, 'utf8'), 'SENTINEL');
    assert.equal(tree(path.join(configDir, 'codex-sessions')).length, statesBefore);
    assert.equal(tree(path.join(vault, 'Log', 'sessions')).length, 0);
    // A SessionEnd for a real session id that never had a counted prompt writes no digest.
    assert.equal(run('session-digest', ['--host', 'codex'], { session_id: 'thr_never', cwd: vault, hook_event_name: 'SessionEnd', reason: 'other' }).stdout.trim(), '{}');
    assert.equal(tree(path.join(vault, 'Log', 'sessions')).length, 0);
    // A real session right after still gets its context and counts.
    assert.match(hook('session-start', { source: 'startup' }).hookSpecificOutput.additionalContext, /# START HERE/);
    assert.match(hook('prompt-route', { session_id: 'thr_real2', prompt: 'green gadget after background' }).hookSpecificOutput.additionalContext, /CODEX BODY/);
    assert.equal(V.readFm(fs.readFileSync(topic, 'utf8')).times_used, String(Number(counted) + 1));
  });
  step('Stop writes one digest from hook inputs; side sessions without a reply leave none', () => {
    hook('prompt-route', { session_id: 'thr_side3', prompt: 'title this chat' });
    run('session-digest', ['--host', 'codex'], { session_id: 'thr_side3', cwd: vault, hook_event_name: 'UserPromptSubmit', prompt: 'title this chat' });
    const side = run('session-digest', ['--host', 'codex'], { session_id: 'thr_side3', cwd: vault, hook_event_name: 'Stop', last_assistant_message: '' });
    assert.equal(side.stdout.trim(), '{}');
    run('session-digest', ['--host', 'codex'], { session_id: 'thr_digest', cwd: vault, hook_event_name: 'UserPromptSubmit', prompt: 'First codex message', transcript_path: ROLLOUT });
    run('session-digest', ['--host', 'codex'], { session_id: 'thr_digest', cwd: vault, hook_event_name: 'UserPromptSubmit', prompt: 'Second codex message' });
    const stop = run('session-digest', ['--host', 'codex'], { session_id: 'thr_digest', cwd: vault, hook_event_name: 'Stop',
      stop_hook_active: false, last_assistant_message: 'Here is the reply.' });
    assert.deepEqual(JSON.parse(stop.stdout), {});
    const files = tree(path.join(vault, 'Log', 'sessions'));
    assert.equal(files.length, 1);
    const text = fs.readFileSync(files[0], 'utf8');
    assert.match(text, /First codex message[\s\S]*Second codex message[\s\S]*Here is the reply/);
    assert.equal(V.readFm(text).host, 'codex');
    const end = run('session-digest', ['--host', 'codex'], { session_id: 'thr_digest', cwd: vault, hook_event_name: 'SessionEnd', reason: 'other' });
    assert.deepEqual(JSON.parse(end.stdout), {});
    assert.equal(V.readFm(fs.readFileSync(files[0], 'utf8')).status, 'closed');
    assert.match(hook('session-start', { source: 'resume' }).hookSpecificOutput.additionalContext, /First codex message/);
  });
  step('debug switch logs raw stdin only when on', () => {
    const logFile = path.join(configDir, 'hook-inputs.log');
    assert(!fs.existsSync(logFile));
    hook('prompt-route', { prompt: 'debug probe' }, { ...env, CONTINUUM_DEBUG: '1' });
    const row = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    assert.equal(row.event, 'UserPromptSubmit'); assert.match(row.stdin, /debug probe/); assert(row.ts);
    assert.equal(row.background, false);
    fs.unlinkSync(logFile);
    hook('prompt-route', { prompt: 'background probe', transcript_path: null }, { ...env, CONTINUUM_DEBUG: '1' });
    assert.equal(JSON.parse(fs.readFileSync(logFile, 'utf8').trim()).background, true);
    fs.unlinkSync(logFile);
    hook('prompt-route', { prompt: 'no debug' });
    assert(!fs.existsSync(logFile));
  });
  step('Codex packaging: own hook file, every command says --host codex, Claude files untouched', () => {
    const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    const overlay = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
    const portable = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
    for (const m of [overlay, portable]) { assert.equal(m.name, 'continuum'); assert.equal(m.version, claude.version); }
    assert.equal(overlay.hooks, './hooks/codex-hooks.json');
    assert.equal(portable.extensions['com.openai'].hooks, './hooks/codex-hooks.json');
    assert.deepEqual(fs.readdirSync(path.join(root, '.claude-plugin')).filter(f => f.endsWith('.json')).sort(), ['marketplace.json', 'plugin.json']);
    assert(!fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8').includes('--host'));
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'codex-hooks.json'), 'utf8')).hooks;
    assert.deepEqual(Object.keys(registry).sort(), ['PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
    for (const [event, groups] of Object.entries(registry)) for (const g of groups) for (const h of g.hooks) {
      const m = h.command.match(/^node "\$\{PLUGIN_ROOT\}\/scripts\/([a-z-]+\.js)" --host codex$/);
      assert(m, h.command); assert(fs.existsSync(path.join(root, 'scripts', m[1])));
      assert.equal(h.type, 'command'); assert(h.timeout <= (event === 'SessionEnd' ? 3 : 10));
      if (/session-start|prompt-route/.test(m[1])) assert(h.additionalContextLimit > 2500);
    }
  });
  console.log('PASS codex: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL codex after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* temp cleanup is best effort */ }
}
