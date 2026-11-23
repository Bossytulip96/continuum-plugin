'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('../scripts/lib/config');
const V = require('../scripts/lib/vault');
const P = require('../scripts/proposal');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-test-'));
const file = path.join(temp, 'config', 'config.json');
const vault = path.join(temp, 'vault');
const env = { ...process.env, CONTINUUM_CONFIG: file, CLAUDE_CONFIG_DIR: path.join(temp, 'claude') };
const hooks = ['session-start', 'prompt-route', 'action-gate', 'session-digest'];
let checks = 0;
function run(name, args = [], input, environment = env, expected = 0) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), ...args], {
    cwd: root, env: environment, input: input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8', timeout: 8000, maxBuffer: 2 * 1024 * 1024
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, name + ': ' + result.stderr + result.stdout);
  return result;
}
function hook(name, extra = {}, environment = env) {
  const event = { 'session-start': 'SessionStart', 'prompt-route': 'UserPromptSubmit',
    'action-gate': 'PreToolUse', 'session-digest': 'Stop' }[name];
  const result = run(name, [], { session_id: 'session-1234', cwd: vault,
    hook_event_name: event, ...extra }, environment);
  const output = JSON.parse(result.stdout);
  assert.equal(typeof output, 'object');
  return output.hookSpecificOutput || {};
}
function step(name, fn) { fn(); checks++; console.log('PASS ' + checks + ': ' + name); }
function read(relative) { return fs.readFileSync(path.join(vault, relative), 'utf8'); }
function note(relative, terms, body = 'A useful note.', pattern = 'test-topic') {
  const target = path.join(vault, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '---\ntype: reference\npattern: ' + pattern + '\nabout: Test fixture\nwhen_to_use: "' + terms + '"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\n# Fixture\n' + body + '\n');
}
function tree(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
let lastGate = '';
function gate(tool_name, tool_input) {
  lastGate = tool_name + ' ' + JSON.stringify(tool_input);
  return hook('action-gate', { tool_name, tool_input });
}
// Approvable levels become Claude Code's own prompt ("ask"); money is denied outright.
function deny(result, level) {
  const want = level === 'money' ? 'deny' : 'ask';
  assert.equal(result.permissionDecision, want, 'expected ' + want + ' (' + level + ') for: ' + lastGate);
  assert.match(result.permissionDecisionReason, new RegExp(level)); if (want === 'ask') assert(result.permissionDecisionReason.endsWith(' Choose Yes or Allow once to let it happen this one time. Choose No or Deny and it does not happen.'));
}
const setupArgs = ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no'];
try {
  // Missing config: every hook is silent (the plugin is not set up yet). Broken config or
  // broken input: the informational hooks fail open, the gate fails closed with a deny.
  const closed = name => name === 'action-gate';
  const expectError = (name, result) => closed(name)
    ? assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
    : assert.deepEqual(JSON.parse(result.stdout), {});
  step('missing config is silent; malformed config or input fails open, except the gate, which denies', () => {
    for (const name of hooks) {
      const result = run(name, [], {});
      assert.deepEqual(JSON.parse(result.stdout), {});
      assert.match(result.stderr, /continuum-setup/);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{invalid');
    for (const name of hooks) expectError(name, run(name, [], {}));
    assert(fs.existsSync(path.join(path.dirname(file), 'hooks.log')));
    fs.writeFileSync(file, JSON.stringify({ version: 9 }));
    for (const name of hooks) expectError(name, run(name, [], {}));
    fs.writeFileSync(file, '{}');
  });
  step('setup creates exactly thirteen templates and is idempotent', () => {
    const output = run('setup', setupArgs).stdout;
    assert.match(output, /Created 13 template files/);
    const files = tree(vault);
    assert.equal(files.length, 13);
    for (const item of files) assert(!/\{\{(?:person|machine|date)\}\}/.test(fs.readFileSync(item, 'utf8')));
    assert.match(read('START HERE.md'), /Sample Person/);
    const before = read('Home.md'); fs.appendFileSync(path.join(vault, 'Home.md'), '\nPreserve this line.\n');
    assert.match(run('setup', setupArgs).stdout, /preserved/);
    assert.equal(read('Home.md'), before + '\nPreserve this line.\n');
    require('./setup-cases')({ run, setupArgs, temp, vault });
    for (const name of hooks) expectError(name, run(name, [], '{invalid'));
  });
  step('SessionStart loads starting page and standing rules and builds index', () => {
    const output = hook('session-start', { source: 'startup' });
    assert.equal(output.hookEventName, 'SessionStart');
    assert.match(output.additionalContext, /\[continuum\]/);
    assert.match(output.additionalContext, /# START HERE/);
    assert.match(output.additionalContext, /Standing rules/); assert(output.additionalContext.includes('node "' + path.join(root, 'scripts', 'approve.js') + '" <level>'));
    assert.match(read('Log/index.md'), /Working Agreements/);
  });
  step('prompt routes whole-word phrases, counts, ranking and injection caps', () => {
    note('Knowledge/Test Topic.md', 'blue widget, test topic', 'PRIMARY');
    const output = hook('prompt-route', { prompt: 'tell me about the blue widget' });
    assert.match(output.additionalContext, /PRIMARY/);
    assert.equal(V.readFm(read('Knowledge/Test Topic.md')).times_used, '1');
    assert.equal(hook('prompt-route', { prompt: 'unrelated words' }).additionalContext, undefined);
    assert.equal(hook('prompt-route', { prompt: 'blue widgets' }).additionalContext, undefined);
    note('Knowledge/Short.md', 'blue widget, test topic', 'SHORT', 'short');
    note('Knowledge/Long.md', 'blue widget, test topic', 'LONG' + 'x'.repeat(800), 'long');
    note('Knowledge/Low.md', 'blue widget', 'LOW', 'low');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.inject.maxNotesPerPrompt = 2;
    fs.writeFileSync(file, JSON.stringify(config));
    const ranked = hook('prompt-route', { prompt: 'blue widget test topic' }).additionalContext;
    assert(ranked.indexOf('Short.md') < ranked.indexOf('Test Topic.md'));
    assert(!ranked.includes('Long.md') && !ranked.includes('Low.md'));
    config.inject.maxNoteChars = 30;
    fs.writeFileSync(file, JSON.stringify(config));
    assert(!hook('prompt-route', { prompt: 'blue widget' }).additionalContext.includes('PRIMARY'));
    config.inject.maxNoteChars = 25000; config.inject.maxNotesPerPrompt = 3;
    fs.writeFileSync(file, JSON.stringify(config));
    // A note that is not valid UTF-8 is injected but never rewritten, so its bytes survive routing.
    const legacy = path.join(vault, 'Knowledge', 'Legacy.md');
    const bytes = Buffer.concat([Buffer.from('---\ntype: reference\npattern: legacy\nabout: x\nwhen_to_use: "legacy topic"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\nCaf', 'utf8'), Buffer.from([0xe9, 0x0a])]);
    fs.writeFileSync(legacy, bytes);
    assert.match(hook('prompt-route', { prompt: 'legacy topic' }).additionalContext, /Legacy\.md/);
    assert(fs.readFileSync(legacy).equals(bytes));
    fs.unlinkSync(legacy);
    // Setup accepts its own config saved with a byte order mark.
    fs.writeFileSync(file, '﻿' + fs.readFileSync(file, 'utf8'));
    assert.match(run('setup', setupArgs).stdout, /preserved/);
  });
  step('gate denies deletion until chat approval, expires approvals and always denies money', () => {
    const deletion = { command: 'Remove-Item "' + path.join(vault, 'Home.md') + '"' };
    deny(gate('Bash', deletion), 'vault-delete');
    deny(gate('Bash', { command: 'rm Home.md' }), 'vault-delete');
    // The approve command itself may quote the person's words, which can name the note and the verb.
    const approveCmd = 'node "' + path.join(root, 'scripts', 'approve.js') + '" vault-delete "yes, delete ' + path.join(vault, 'Home.md') + ' now"';
    assert.equal(gate('Bash', { command: approveCmd }).permissionDecision, undefined);
    // Every reviewed bypass form lives in gate-cases.js and runs through the real hook here.
    for (const [tool, input, want] of require('./gate-cases')({ vault, root })) {
      if (want === 'allow') assert.equal(gate(tool, input).permissionDecision, undefined, 'expected allow for: ' + lastGate);
      else deny(gate(tool, input), want);
    }
    const removalJs = "require('fs').unlinkSync('" + path.join(vault, 'Home.md').split(path.sep).join('/') + "')";
    deny(gate('Bash', { command: 'node -e "' + removalJs + '"' }), 'vault-delete');
    if (process.platform === 'win32') {
      // Claude Code's Bash tool on Windows spells C:\ as /c/ (found live 2026-11-03: a delete slipped past the gate).
      const gitBash = '/' + vault[0].toLowerCase() + vault.slice(2).split(path.sep).join('/') + '/Home.md';
      deny(hook('action-gate', { tool_name: 'Bash', tool_input: { command: 'rm "' + gitBash + '"' }, cwd: 'C:\\Windows\\System32' }), 'vault-delete');
      deny(hook('action-gate', { tool_name: 'Bash', tool_input: { command: 'f="' + gitBash + '"; cat "$f"; cp "$f" /c/tmp/x.md && rm "$f"' }, cwd: 'C:\\Windows\\System32' }), 'vault-delete');
    }
    assert.match(run('approve', ['vault-delete', 'ok']).stdout, /expir/i);
    assert.equal(gate('Bash', deletion).permissionDecision, 'allow');
    const approvals = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'approvals.json'), 'utf8'));
    assert(approvals['vault-delete'].expires - approvals['vault-delete'].issued <= 3600000);
    approvals['vault-delete'].issued = Date.now() - 7200000;
    approvals['vault-delete'].expires = Date.now() - 3600000;
    fs.writeFileSync(path.join(path.dirname(file), 'approvals.json'), JSON.stringify(approvals));
    deny(gate('Bash', deletion), 'vault-delete');
    deny(gate('Bash', { command: 'winget install sample-package' }), 'system-change');
    deny(gate('mcp__x__send_mail', {}), 'email-send');
    deny(gate('mcp__x__create_record', {}), 'vendor-write');
    deny(gate('Write', { file_path: path.join(path.dirname(file), '..', '.claude', 'settings.local.json'), content: '{}' }), 'system-change');
    deny(gate('mcp__commerce__checkout', {}), 'money');
    assert.equal(gate('mcp__files__transfer_document', {}).permissionDecision, undefined);
    run('approve', ['money', 'ok'], undefined, env, 1);
    assert.equal(gate('Bash', { command: 'printf "hello"' }).permissionDecision, undefined);
    const config = JSON.parse(fs.readFileSync(file, 'utf8')); config.autonomy = 'trusted';
    fs.writeFileSync(file, JSON.stringify(config)); run('approve', ['email-send', 'yes send it']);
    const trusted = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'approvals.json'), 'utf8'))['email-send'];
    assert.equal(trusted.expires - trusted.issued, 86400000);
    assert.equal(gate('mcp__x__send_mail', {}).permissionDecision, 'allow');
    config.autonomy = 'ask'; fs.writeFileSync(file, JSON.stringify(config));
  });
  step('vault writes preserve backups and duplicate notes need approval', () => {
    const home = path.join(vault, 'Home.md');
    const old = read('Home.md');
    assert.equal(gate('Write', { file_path: home, content: 'Updated' }).permissionDecision, undefined);
    const backups = tree(path.join(vault, '.backups'));
    assert(backups.some(name => fs.readFileSync(name, 'utf8') === old));
    deny(gate('Write', { file_path: home, content: '' }), 'vault-delete');
    // An Edit that leaves the note empty is a delete too, backed up before the prompt; an ordinary Edit is a backed-up write.
    fs.writeFileSync(home, 'Updated');
    deny(gate('Edit', { file_path: home, old_string: 'Updated', new_string: '' }), 'vault-delete'); assert(tree(path.join(vault, '.backups')).some(name => fs.readFileSync(name, 'utf8') === 'Updated'));
    assert.equal(gate('Edit', { file_path: home, old_string: 'Updated', new_string: 'Changed' }).permissionDecision, undefined);
    // A junction or symlink into the vault counts as the vault.
    const alias = path.join(path.dirname(vault), 'alias-into-vault');
    try { fs.symlinkSync(vault, alias, 'junction'); } catch (_) { /* no link rights on this machine */ }
    if (fs.existsSync(alias)) {
      deny(gate('Write', { file_path: path.join(alias, 'Home.md'), content: '' }), 'vault-delete');
      deny(gate('Bash', { command: 'rm "' + path.join(alias, 'Home.md').split(path.sep).join('/') + '"' }), 'vault-delete');
    }
    const duplicate = { file_path: path.join(vault, 'Knowledge', 'Alias.md'), content: '---\npattern: test-topic\n---\nDuplicate' };
    deny(gate('Write', duplicate), 'new-note');
    deny(gate('Write', { file_path: path.join(vault, 'Knowledge', 'Copies', 'Test Topic.md'), content: '---\npattern: distinct-pattern\n---\nSame title' }), 'new-note');
    run('approve', ['new-note', 'yes this separate note is needed']);
    assert.equal(gate('Write', duplicate).permissionDecision, 'allow');
  });
  step('decision log, proposal answers, once-per-session proposals and corrections', () => {
    run('decision-log', ['test area', 'test level', 'done', 'Receipt line']);
    run('proposal', ['add', 'workflow', 'Blue review', 'Review the blue widget', 'Local note', 'blue widget']);
    assert.match(run('proposal', ['list']).stdout, /p1/);
    const first = hook('prompt-route', { session_id: 'proposal-session', prompt: 'blue widget' });
    assert.match(first.additionalContext, /\[proposal\].*p1/);
    assert(!hook('prompt-route', { session_id: 'proposal-session', prompt: 'blue widget' }).additionalContext.includes('[proposal]'));
    run('proposal', ['later', 'p1', 'ask me later']);
    assert.match(run('proposal', ['list']).stdout, /later/);
    run('proposal', ['yes', 'p1', 'yes review it']);
    assert.match(read('Log/proposals.md'), /accepted/);
    hook('prompt-route', { prompt: "that's wrong, too long" });
    const logs = tree(path.join(vault, 'Log')).filter(p => path.basename(p).startsWith('decisions-'));
    const text = logs.map(p => fs.readFileSync(p, 'utf8')).join('\n');
    assert.match(text, /Receipt line/); assert.match(text, /correction \(candidate\)/);
    assert.match(text, /yes review it/); assert.match(text, /allow-by-token/);
  });
  step('Stop digest contains user text, excludes tool results, updates one file and obeys guard', () => {
    const transcript = path.join(vault, 'Log', 'test-transcript.jsonl');
    const rows = [
      { type: 'user', timestamp: new Date().toISOString(), message: { content: 'First user message' } },
      { type: 'assistant', message: { content: 'Assistant words' } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'SECRETTOOL' }] } },
      { type: 'user', message: { content: [{ type: 'text', text: 'Second user message' }] } }
    ];
    fs.writeFileSync(transcript, rows.map(r => JSON.stringify(r)).join('\n'));
    const input = { transcript_path: transcript, session_id: 'digest-1234' };
    hook('session-digest', input); hook('session-digest', input);
    const files = tree(path.join(vault, 'Log', 'sessions')); assert.equal(files.length, 1);
    const digest = fs.readFileSync(files[0], 'utf8');
    assert.match(digest, /First user message/); assert.match(digest, /Second user message/);
    assert(!digest.includes('SECRETTOOL') && !digest.includes('Assistant words'));
    assert.equal(V.readFm(digest).session, 'digest-1234');
    hook('session-digest', { ...input, stop_hook_active: true });
    assert.equal(fs.readFileSync(files[0], 'utf8'), digest);
    assert.match(hook('session-start').additionalContext, /First user message/);
    // Once SessionEnd closes a digest, a late Stop keeps it closed.
    run('session-digest', [], { session_id: 'digest-1234', cwd: vault, hook_event_name: 'SessionEnd', transcript_path: transcript });
    assert.equal(V.readFm(fs.readFileSync(files[0], 'utf8')).status, 'closed');
    hook('session-digest', input);
    assert.equal(V.readFm(fs.readFileSync(files[0], 'utf8')).status, 'closed');
    // Two sessions that share their first eight characters get two files.
    hook('session-digest', { ...input, session_id: 'digest-1234-other' });
    assert.equal(tree(path.join(vault, 'Log', 'sessions')).length, 2);
    // An interrupted turn never reaches Stop, so a submitted message writes the digest too:
    // before the transcript exists, and without repeating a message the transcript already holds.
    const submit = (session_id, transcript_path, prompt) => {
      assert.equal(run('session-digest', [], { session_id, cwd: vault, hook_event_name: 'UserPromptSubmit', transcript_path, prompt }).stdout.trim(), '{}');
      return tree(path.join(vault, 'Log', 'sessions')).map(f => fs.readFileSync(f, 'utf8')).find(text => V.readFm(text).session === session_id);
    };
    assert.match(submit('submit-early', path.join(vault, 'Log', 'not-yet.jsonl'), 'Only message so far'), /Only message so far/);
    assert.match(submit('submit-added', transcript, 'Third user message'), /First user message[\s\S]*Third user message/);
    assert.equal(submit('submit-same', transcript, ' Second user message ').split('Second user message').length, 2);
    assert.match(submit('submit-added', path.join(vault, 'Log', 'not-yet.jsonl'), 'Alone'), /First user message/);
    assert.equal(tree(path.join(vault, 'Log', 'sessions')).length, 5);
  });
  step('consolidation indexes notes, reports stale proposals and proposes exactly once after three actions', () => {
    for (let i = 0; i < 3; i++) run('decision-log', ['action: count receipts', 'test', 'done', 'Counted']);
    run('proposal', ['add', 'review', 'Old review', 'Review old item', 'Dated record', 'old item']);
    const proposalsPath = path.join(vault, 'Log', 'proposals.md');
    const old = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
    fs.writeFileSync(proposalsPath, read('Log/proposals.md').replace(/(\| p2 \| )\d{4}-\d{2}-\d{2}/, '$1' + old));
    const before = read('Home.md');
    const output = run('consolidate', ['--nightly']).stdout;
    assert.match(output, /count receipts: 3/); assert.match(output, /Old review/); assert(!/- (?:Bash|Write|Edit):/.test(output), 'gate lines are not repeatable actions');
    assert(read('Home.md').length > before.length); assert.match(read('Log/index.md'), /Test Topic/);
    env.CONTINUUM_CONFIG = file;
    const config = C.validate(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    assert.equal(P.load(config).filter(p => p.subject === 'count receipts').length, 1);
    run('consolidate', ['--weekly']);
    assert.equal(P.load(config).filter(p => p.subject === 'count receipts').length, 1);
    const status = run('consolidate', ['--status']).stdout;
    for (const label of ['Config:', 'Vault:', 'Notes:', 'Skills:', 'Pending proposals:', 'Last digest:', 'Approvals in force:']) assert(status.includes(label));
  });
  step('plugin exec contract and path containment reject traversal and dangling links', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'continuum'); assert.equal(manifest.version, '0.8.1'); assert.equal(manifest.license, 'MIT');
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
    assert.deepEqual(Object.keys(registry).sort(), ['PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
    for (const registrations of Object.values(registry)) for (const registration of registrations) {
      for (const item of registration.hooks) {
        assert.equal(item.type, 'command'); assert.equal(item.command, 'node');
        assert(item.timeout < 10); assert.equal(item.args.length, 1);
        assert(item.args[0].startsWith('$' + '{CLAUDE_PLUGIN_ROOT}/scripts/'));
        assert(fs.existsSync(path.join(root, item.args[0].split('/scripts/')[1] ? 'scripts/' + item.args[0].split('/scripts/')[1] : '')));
      }
    }
    const config = C.validate(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    assert.throws(() => C.vaultPath(config, '..', 'escape.md'));
    const linked = path.join(vault, 'dangling-link');
    fs.symlinkSync(path.join(temp, 'absent'), linked, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => C.vaultPath(config, 'dangling-link', 'escape.md'));
    const stateFile = C.sessionFile(config, 'bad-state');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, 'null');
    assert.match(hook('prompt-route', { session_id: 'bad-state', prompt: 'blue widget' }).additionalContext, /PRIMARY/);
  });
  console.log('PASS smoke: ' + checks + ' integration groups');
} catch (error) {
  console.error('FAIL smoke after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
}
