'use strict';
// Google Antigravity host cases. Every hook runs as a real child process through scripts/antigravity-hook.js,
// the way the plugin's hooks.json starts it, with Antigravity-shaped stdin, against a throwaway home and vault.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const A = require('../scripts/lib/antigravity');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-antigravity-'));
const home = path.join(temp, 'home');
const gemini = path.join(temp, '.gemini');
const vault = path.join(temp, 'vault');
const configDir = path.join(home, '.continuum', 'antigravity');
const env = { ...process.env, USERPROFILE: home, HOME: home, CONTINUUM_GEMINI_HOME: gemini, CODEX_HOME: path.join(temp, 'codex-home'), CLAUDE_CONFIG_DIR: path.join(temp, 'claude') };
delete env.CONTINUUM_CONFIG; delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
const answers = ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask'];
let checks = 0;
function script(name, args, expected = 0, input = '') {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', name + '.js'), ...args], { cwd: root, env, input, encoding: 'utf8', timeout: 15000 });
  assert.ifError(r.error); assert.equal(r.status, expected, r.stderr + r.stdout);
  return r.stdout;
}
// One hook call: raw stdin text, run from the plugin folder as Antigravity does; always exit 0 and one JSON object.
function raw(event, text, environment = env) {
  const r = spawnSync(process.execPath, ['./scripts/antigravity-hook.js', event], { cwd: root, env: environment, input: text, encoding: 'utf8', timeout: 15000 });
  assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, r.stdout);
  const out = JSON.parse(lines[0]);
  assert(out && typeof out === 'object' && !Array.isArray(out));
  return out;
}
const common = extra => ({ conversationId: 'conv-1', workspacePaths: [vault], transcriptPath: path.join(temp, 'transcript.jsonl'),
  artifactDirectoryPath: path.join(temp, 'artifacts'), modelName: 'sample-model', ...extra });
const hook = (event, extra) => raw(event, JSON.stringify(common(extra)));
const gate = (name, args) => hook('PreToolUse', { toolCall: { name, args }, stepIdx: 3 });
const steps = out => (out.injectSteps || []).map(s => s.systemMessage.systemMessage).join('\n');
let inv = 0;
const invoke = (text, initialNumSteps, invocationNum = inv++) => hook('PreInvocation', { lastUserInput: text, invocationNum, initialNumSteps });
const note = (rel, terms) => {
  fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  fs.writeFileSync(path.join(vault, rel), '---\ntype: reference\npattern: ag-topic\nabout: x\nwhen_to_use: "' + terms +
    '"\ntrust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\n# Fixture\nAG BODY\n');
};
function step(name, fn) { fn(); checks++; console.log('PASS antigravity ' + checks + ': ' + name); }
try {
  step('manifest, hooks.json, rules and skills have the documented shape', () => {
    const m = JSON.parse(fs.readFileSync(path.join(root, '.antigravity-plugin', 'plugin.json'), 'utf8'));
    const allowed = ['$schema', 'name', 'displayName', 'description', 'version', 'disabled', 'logo', 'suggestedPrompts', 'skills',
      'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
    assert.deepEqual(Object.keys(m).filter(k => !allowed.includes(k)), []);
    assert.match(m.name, /^[a-z0-9]+(-[a-z0-9]+)*$/); assert.equal(m.displayName, 'Continuum'); assert.equal(m.license, 'MIT');
    assert.equal(m.version, JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version);
    const h = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8'));
    assert.deepEqual(Object.keys(h), ['continuum']); assert.deepEqual(Object.keys(h.continuum), A.EVENTS);
    for (const event of ['SessionStart', 'PreInvocation', 'Stop']) {
      for (const x of h.continuum[event]) { assert.equal(x.matcher, undefined); assert.equal(x.type, 'command'); assert.equal(x.command, 'node ./scripts/antigravity-hook.js ' + event); }
    }
    assert.equal(h.continuum.PreToolUse[0].matcher, '');
    assert.equal(h.continuum.PreToolUse[0].hooks[0].command, 'node ./scripts/antigravity-hook.js PreToolUse');
    assert(!/^---/.test(fs.readFileSync(path.join(root, 'rules', 'AGENTS.md'), 'utf8')));
    for (const dir of fs.readdirSync(path.join(root, 'skills'))) {
      const fm = fs.readFileSync(path.join(root, 'skills', dir, 'SKILL.md'), 'utf8').match(/^---\r?\n(?:[\s\S]*?\n)?name:\s*(\S+)/);
      assert.equal(fm && fm[1], dir);
    }
  });
  step('translation helpers: input, tool calls, MCP names, gate answers', () => {
    const t = A.toInternal('PreToolUse', common({ toolCall: { name: 'run_command', args: { CommandLine: 'dir', Cwd: temp } } }));
    assert.equal(t.session_id, 'conv-1'); assert.equal(t.cwd, temp); assert.equal(t.tool_input.command, 'dir');
    assert.equal(A.tool({ name: 'run_command', args: {} }, 'win32').tool_name, 'PowerShell');
    assert.equal(A.tool({ name: 'run_command', args: {} }, 'linux').tool_name, 'Bash');
    assert.deepEqual(A.tool({ name: 'write_to_file', args: { TargetFile: 'a.md', CodeContent: 'x', Overwrite: true } }),
      { tool_name: 'Write', tool_input: { file_path: 'a.md', content: 'x' } });
    assert.equal(A.tool({ name: 'replace_file_content', args: { TargetFile: 'a.md', TargetContent: 'o', ReplacementContent: 'n' } }).tool_input.old_string, 'o');
    assert.equal(A.tool({ name: 'multi_replace_file_content', args: { TargetFile: 'a.md', ReplacementChunks: [{}, {}] } }).tool_name, 'Edit');
    assert.equal(A.tool({ name: 'view_file', args: { AbsolutePath: 'x' } }).tool_name, 'view_file');
    // The names the App really uses (seen live), next to the documented ones above.
    assert.deepEqual(A.tool({ name: 'write_file', args: { Path: 'a.md', Content: 'x', Overwrite: true } }), { tool_name: 'Write', tool_input: { file_path: 'a.md', content: 'x' } });
    assert.equal(A.tool({ name: 'write_file', args: { Path: 'a.md', Content: '', Append: true } }).tool_input.content, 'appended');
    assert.deepEqual(A.tool({ name: 'edit_file', args: { Path: 'a.md', Target: 'o', Replacement: 'n' } }).tool_input, { file_path: 'a.md', old_string: 'o', new_string: 'n', replace_all: false });
    assert.equal(A.tool({ name: 'read_file', args: { Path: 'x' } }).tool_name, 'read_file');
    assert.equal(A.tool({ name: 'call_mcp_tool', args: { ServerName: 'notion', ToolName: 'createPage', Arguments: { a: 1 } } }).tool_name, 'mcp__notion__create_Page');
    assert.equal(A.tool({ name: 'call_mcp_tool', args: {} }).tool_name, 'mcp__unknown__update_unknown');
    assert.equal(A.tool({ name: 'delete_file', args: { Path: 'a.md' } }, 'win32').tool_input.command, 'Remove-Item "a.md"');
    assert.equal(A.tool({ name: 'run_workflow', args: { Script: 'x', ScriptPath: 'y.js' } }, 'win32').tool_input.command, 'x y.js');
    assert.equal(A.mcpName('mcp_docs-api_docs-server_search_docs'), 'mcp__docs-api__docs-server_search_docs');
    assert.equal(A.toInternal('PreToolUse', { cwd: temp, workspacePaths: [], toolCall: { name: 'run_command', args: { CommandLine: 'dir' } } }).cwd, temp);
    assert.deepEqual(A.levels('PowerShell', { command: 'gmail mutate send --to "a@example.com" --subject x' }), ['email-send']);
    assert.deepEqual(A.levels('PowerShell', { command: 'cd x; gdrive mutate upload file.txt' }), ['vendor-write']);
    assert.deepEqual(A.levels('PowerShell', { command: 'gcalendar create "Lunch"' }), ['vendor-write']);
    assert.deepEqual(A.levels('PowerShell', { command: 'gmail readonly search "is:unread" --max 5' }), []);
    assert.deepEqual(A.levels('PowerShell', { command: '  gmail mutate send --to "a@example.com"' }), ['email-send']);
    assert.deepEqual(A.levels('PowerShell', { command: 'cd x' + String.fromCharCode(10) + 'gmail mutate reply --message 1 --body "ok"' }), ['email-send']);
    // A first call whose routing failed keeps the count of the person's messages for the retry that works.
    const kept = A.nextState(A.nextState({}, { lastUserInput: 'x', invocationNum: 0 }, false, true, 5), { lastUserInput: 'x', invocationNum: 1 }, true, false, undefined);
    assert.equal(kept.userInputs, 5); assert.equal(kept.pending, undefined);
    assert.equal(A.isNewMessage(kept, { lastUserInput: 'x', invocationNum: 0 }, 6), true);
    assert.deepEqual(A.levels('PowerShell', { command: 'node x.js email-send "yes, gmail mutate send it"' }), []);
    // The reply for the digest comes from the transcript only when it follows the last message.
    const tr = path.join(temp, 'reply.jsonl');
    const line = o => JSON.stringify(o) + String.fromCharCode(10);
    fs.writeFileSync(tr, line({ type: 'USER_INPUT', content: 'q' }) + line({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'the answer' }));
    assert.equal(A.toInternal('Stop', { transcriptPath: tr }).last_assistant_message, 'the answer');
    fs.appendFileSync(tr, line({ type: 'USER_INPUT', content: 'q2' }) + line({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: '' }));
    assert.match(A.toInternal('Stop', { transcriptPath: tr, terminationReason: 'done' }).last_assistant_message, /does not pass the reply.*done/);
    assert.equal(A.mcpName('mcp_mail_send_message'), 'mcp__mail__send_message');
    assert.equal(A.mcpName('continuum_my_server_delete_item'), 'mcp__continuum_my_server__delete_item');
    assert.equal(A.mcpName('mcp__a__b'), 'mcp__a__b');
    assert.equal(A.mcpName('mcp_my_server_deleteItem'), 'mcp__my_server__delete_Item');
    assert.equal(A.mcpName('mcp__payments__transferFunds'), 'mcp__payments__transfer_Funds');
    // A message whose routing failed stays pending and is new on every later call until one works.
    const failed = A.nextState({ lastHash: A.hash('x'), routedSteps: 10, prevSteps: 10 }, { lastUserInput: 'x', initialNumSteps: 20, invocationNum: 5 }, false, true);
    assert.equal(A.isNewMessage(failed, { lastUserInput: 'x', initialNumSteps: 20, invocationNum: 6 }), true);
    assert.equal(A.isNewMessage(A.nextState(failed, { lastUserInput: 'x', initialNumSteps: 20, invocationNum: 6 }, true), { lastUserInput: 'x', initialNumSteps: 20, invocationNum: 7 }), false);
    assert.equal(A.mcpName('mcp_notes_settings_get'), 'mcp__notes__settings_get');
    const r = A.toInternal('PreInvocation', common({ lastUserInput: 'hi' }));
    assert.equal(r.prompt, 'hi'); assert.equal(r.cwd, vault); assert.equal(r.hook_event_name, 'UserPromptSubmit');
    assert.match(A.toInternal('Stop', common({ terminationReason: 'done' })).last_assistant_message, /done/);
    assert.deepEqual(A.decision({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'r' } }), { decision: 'force_ask', reason: 'r' });
    assert.deepEqual(A.decision({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'r' } }), { decision: 'deny', reason: 'r' });
    assert.deepEqual(A.decision({}), { decision: 'allow' });
    assert.deepEqual(A.inject('x'), { injectSteps: [{ systemMessage: { systemMessage: 'x' } }] });
  });
  step('before setup every event answers a valid empty object; garbage stdin too', () => {
    for (const e of A.EVENTS) assert.deepEqual(raw(e, 'not json'), A.empty(e));
    assert.deepEqual(raw('Bogus', ''), {});
  });
  step('setup --hooks plugin writes the per-host config and the vault templates, and no hooks file', () => {
    const out = script('setup', ['--host', 'antigravity', ...answers]);
    assert(fs.existsSync(path.join(configDir, 'config.json'))); assert(!fs.existsSync(path.join(home, '.continuum', 'config.json')));
    assert(fs.existsSync(path.join(vault, 'START HERE.md'))); assert.match(out, /No hooks file written \(--hooks plugin\)/);
    assert(!fs.existsSync(gemini));
  });
  step('SessionStart: one systemMessage step with the start page and the Antigravity approve line', () => {
    const text = steps(hook('SessionStart', {}));
    assert.match(text, /# START HERE/); assert.match(text, /Antigravity shows the person its own permission prompt/);
    assert(text.includes('node "' + path.join(root, 'scripts', 'approve.js') + '" --host antigravity <level>'));
  });
  step('empty and garbage stdin after setup: exit 0, valid JSON; the gate fails closed on garbage', () => {
    for (const e of ['SessionStart', 'PreInvocation', 'Stop']) { raw(e, ''); assert.deepEqual(raw(e, '{broken'), {}); }
    // After setup a call that names no tool cannot be evaluated, so it is denied like broken input.
    for (const bad of ['', '{broken', '{"toolCall":{}}', '{"tool_call":{"name":"run_command"}}']) assert.equal(raw('PreToolUse', bad).decision, 'deny', bad);
  });
  step('PreInvocation routes a message once per turn; the same text again only when the person really sent it again', () => {
    note('Knowledge/Ag Topic.md', 'blue widget');
    const said = () => fs.appendFileSync(path.join(temp, 'transcript.jsonl'), JSON.stringify({ type: 'USER_INPUT', content: 'x' }) + String.fromCharCode(10));
    said();
    assert.match(steps(invoke('the blue widget please', 1, 0)), /AG BODY/);
    // Later calls of the same turn: the call number counts up and the step count grows (seen live).
    assert.deepEqual(invoke('the blue widget please', 5, 1), {});
    assert.deepEqual(invoke('the blue widget please', 8, 2), {});
    // A new turn that the person did not start (a system message): the text is the old one, nothing is loaded again.
    assert.deepEqual(invoke('the blue widget please', 11, 0), {});
    // The person sends the same text again: one more message in the transcript, so it is loaded again, once.
    said();
    assert.match(steps(invoke('the blue widget please', 14, 0)), /AG BODY/);
    assert.deepEqual(invoke('the blue widget please', 17, 1), {});
    assert.match(steps(invoke('another blue widget question', 20, 0)), /AG BODY/);
    assert.deepEqual(invoke('', 23, 0), {});
    const st = { lastHash: A.hash('x'), userInputs: 1 };
    assert.equal(A.isNewMessage(st, { lastUserInput: 'x', invocationNum: 0 }, 1), false);
    assert.equal(A.isNewMessage(st, { lastUserInput: 'x', invocationNum: 0 }, 2), true);
    assert.equal(A.isNewMessage(st, { lastUserInput: 'x', invocationNum: 0 }, undefined), false);
    assert.equal(A.isNewMessage(st, { lastUserInput: 'y', invocationNum: 3 }, undefined), true);
  });
  step('Stop writes the digest from inputs and prints {}', () => {
    assert.deepEqual(hook('Stop', { executionNum: 1, terminationReason: 'model_done', fullyIdle: true }), {});
    const dir = path.join(vault, 'Log', 'sessions');
    const files = fs.readdirSync(dir).filter(f => / antigravity /.test(f));
    assert.equal(files.length, 1);
    const text = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    assert.match(text, /host: "antigravity"/); assert.match(text, /the blue widget please/); assert.match(text, /model_done/);
  });
  step('gate cases through the real entry point', () => {
    const target = path.join(vault, 'Knowledge', 'Ag Topic.md');
    const del = gate('run_command', { CommandLine: 'Remove-Item "' + target + '"', Cwd: vault });
    assert.equal(del.decision, 'force_ask'); assert.match(del.reason, /vault-delete/);
    assert.equal(gate('mcp_shop_purchase_item', { item: 'x' }).decision, 'deny');
    assert.equal(gate('mcp_payments_transfer_funds', {}).decision, 'deny');
    assert.equal(gate('mcp_payments_transferFunds', {}).decision, 'deny');
    const before = fs.readFileSync(target, 'utf8');
    const w = gate('write_to_file', { TargetFile: target, CodeContent: before + '\nmore\n', Overwrite: true });
    assert.deepEqual(w, { decision: 'allow' });
    const copies = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : copies.push(path.join(d, e.name)); };
    walk(path.join(vault, '.backups'));
    assert(copies.some(f => f.endsWith(path.join('Knowledge', 'Ag Topic.md')) && fs.readFileSync(f, 'utf8') === before));
    assert.deepEqual(gate('replace_file_content', { TargetFile: target, TargetContent: 'AG BODY', ReplacementContent: 'AG BODY 2' }), { decision: 'allow' });
    assert.deepEqual(gate('view_file', { AbsolutePath: target }), { decision: 'allow' });
    // Two chunks that together empty a note are seen as one edit that empties it; two that do not are allowed.
    const two = path.join(vault, 'Knowledge', 'Two.md');
    fs.writeFileSync(two, 'alpha\nbeta');
    const chunks = last => [{ TargetContent: 'alpha\n', ReplacementContent: '' }, { TargetContent: 'beta', ReplacementContent: last }];
    const emptied = gate('multi_replace_file_content', { TargetFile: two, ReplacementChunks: chunks('') });
    assert.equal(emptied.decision, 'force_ask'); assert.match(emptied.reason, /vault-delete/);
    assert.deepEqual(gate('multi_replace_file_content', { TargetFile: two, ReplacementChunks: chunks('gamma') }), { decision: 'allow' });
    // A path relative to the workspace is read from there, not from the hook's own folder.
    assert.equal(gate('multi_replace_file_content', { TargetFile: path.join('Knowledge', 'Two.md'), ReplacementChunks: chunks('') }).decision, 'force_ask');
    // The App's own names through the real entry point: a write is copied first, an edit or a delete that
    // empties or removes a note is asked, a read is free, mail and outside changes are asked, money is refused.
    const live = fs.readFileSync(target, 'utf8');
    assert.deepEqual(gate('write_file', { Path: target, Content: live + '\nlive\n', Overwrite: true }), { decision: 'allow' });
    assert(fs.readdirSync(path.join(vault, '.backups'), { recursive: true }).some(f => String(f).endsWith('Ag Topic.md')));
    assert.match(gate('edit_file', { Path: two, Target: 'alpha\nbeta', Replacement: '' }).reason, /vault-delete/);
    assert.match(gate('delete_file', { Path: two }).reason, /vault-delete/);
    assert.deepEqual(gate('read_file', { Path: target }), { decision: 'allow' });
    assert.match(gate('run_command', { CommandLine: 'gmail mutate send --to "a@example.com" --subject "Hi" --body "x"' }).reason, /email-send/);
    assert.match(gate('run_command', { CommandLine: 'gsheets mutate write SHEET "Sheet1!A1" "x"' }).reason, /vendor-write/);
    assert.deepEqual(gate('run_command', { CommandLine: 'gmail readonly search "is:unread" --max 5' }), { decision: 'allow' });
    assert.match(gate('call_mcp_tool', { ServerName: 'notion', ToolName: 'create_page', Arguments: {} }).reason, /vendor-write/);
    assert.deepEqual(gate('call_mcp_tool', { ServerName: 'notion', ToolName: 'search', Arguments: {} }), { decision: 'allow' });
    assert.equal(gate('call_mcp_tool', { ServerName: 'payments', ToolName: 'transferFunds', Arguments: {} }).decision, 'deny');
    assert.equal(gate('call_mcp_tool', {}).decision, 'force_ask');
    assert.deepEqual(gate('mcp_docs-api_docs-server_search_docs', { query: 'x' }), { decision: 'allow' });
    // A camelCase MCP action that changes an outside system is asked, not allowed.
    assert.equal(gate('mcp_my_server_deleteItem', { id: 1 }).decision, 'force_ask');
    assert.deepEqual(gate('mcp_my_server_getItem', { id: 1 }), { decision: 'allow' });
    assert.equal(gate('schedule', { CronExpression: '0 9 * * *', Prompt: 'x' }).decision, 'force_ask');
    assert.deepEqual(gate('schedule', { Prompt: 'x' }), { decision: 'allow' });
    const hooksFile = path.join(gemini, 'config', 'hooks.json');
    assert.equal(gate('write_to_file', { TargetFile: hooksFile, CodeContent: '{}' }).decision, 'force_ask');
    assert.equal(gate('run_command', { CommandLine: 'Set-Content "' + path.join(vault, '.agents', 'hooks.json') + '" x' }).decision, 'force_ask');
  });
  step('pre-approval with the approve line lets the same call through; the approve line itself is not gated', () => {
    const line = { CommandLine: 'node "' + path.join(root, 'scripts', 'approve.js') + '" --host antigravity system-change "yes, schedule it and delete Knowledge notes"' };
    assert.deepEqual(gate('run_command', line), { decision: 'allow' });
    script('approve', ['--host', 'antigravity', 'system-change', 'yes, schedule it']);
    assert.deepEqual(gate('schedule', { CronExpression: '0 9 * * *', Prompt: 'x' }), { decision: 'allow' });
  });
  step('debug: true logs each raw hook input; an unreadable config denies the gate and fails open elsewhere', () => {
    const file = path.join(configDir, 'config.json');
    const good = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(good), debug: true }));
    hook('SessionStart', {});
    const log = fs.readFileSync(path.join(configDir, 'hook-inputs.log'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(log[log.length - 1].event, 'SessionStart'); assert.equal(log[log.length - 1].host, 'antigravity');
    fs.writeFileSync(file, '{ not json');
    const d = gate('view_file', { AbsolutePath: 'x' });
    assert.equal(d.decision, 'deny'); assert.match(d.reason, /could not evaluate/);
    for (const e of ['SessionStart', 'PreInvocation', 'Stop']) assert.deepEqual(hook(e, { lastUserInput: 'x' }), {});
    fs.writeFileSync(file, good);
  });
  step('setup --hooks global merges a continuum group; a second run changes nothing; --remove keeps other groups', () => {
    const file = path.join(gemini, 'config', 'hooks.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const other = { 'my-linter': { PreToolUse: [{ matcher: 'write_to_file', hooks: [{ type: 'command', command: 'echo lint' }] }] } };
    fs.writeFileSync(file, JSON.stringify(other));
    assert.match(script('setup', ['--host', 'antigravity', ...answers, '--hooks', 'global']), /1 other hook group\(s\) kept[\s\S]*Warning/);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(data['my-linter'], other['my-linter']);
    const cmds = require('../scripts/lib/antigravity-setup').handlers(data.continuum).map(h => h.command);
    assert.equal(cmds.length, 4);
    for (const c of cmds) {
      const s = c.match(/^node "([^"]+)" (\w+)$/); assert(s && fs.existsSync(s[1]) && A.EVENTS.includes(s[2]), c);
    }
    assert.equal(fs.readdirSync(path.dirname(file)).filter(f => f.startsWith('hooks.json.bak-')).length, 1);
    const before = fs.readFileSync(file);
    assert.match(script('setup', ['--host', 'antigravity', ...answers, '--hooks', 'global']), /unchanged/);
    assert(fs.readFileSync(file).equals(before));
    assert.equal(fs.readdirSync(path.dirname(file)).filter(f => f.startsWith('hooks.json.bak-')).length, 1);
    // The generated global command really runs from another folder.
    const r = spawnSync(cmds.find(c => c.endsWith('SessionStart')), { shell: true, cwd: temp, env, input: JSON.stringify(common({})), encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr); assert.match(steps(JSON.parse(r.stdout)), /# START HERE/);
    const status = script('status', ['--host', 'antigravity']);
    assert.match(status, /PASS config found/); assert.match(status, /4 Continuum hook\(s\), every script exists/);
    assert.match(script('setup', ['--host', 'antigravity', '--remove']), /other groups kept/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), other);
    assert(!fs.existsSync(path.join(gemini, 'config', 'config.json')));
    assert.match(script('status', ['--host', 'antigravity'], 1), /FAIL Antigravity hooks: none found/);
    // A plugin folder inside the vault's .agents/plugins (one workspace only) is found too.
    const ws = path.join(vault, '.agents', 'plugins', 'continuum');
    fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(root, 'hooks.json'), path.join(ws, 'hooks.json'));
    fs.writeFileSync(path.join(ws, 'scripts', 'antigravity-hook.js'), '');
    assert(script('status', ['--host', 'antigravity']).includes(path.join(ws, 'hooks.json') + ': 4 Continuum hook(s), every script exists'));
    console.log(status.trim().split('\n').map(l => '    ' + l).join('\n'));
  });
  step('the other hosts are unchanged: the Claude default stays silent without its own config', () => {
    const plain = spawnSync(process.execPath, [path.join(root, 'scripts', 'session-start.js')], { env, input: '{}', encoding: 'utf8' });
    assert.deepEqual(JSON.parse(plain.stdout), {});
    assert.equal(require('../scripts/lib/host').HOSTS.length, 4);
    // On another host the approve line keeps its exemption when the person's quoted words mention the flag,
    // and a line that really carries the Antigravity flag is not exempt there.
    const G = require('../scripts/action-gate');
    const approve = 'node "' + path.join(root, 'scripts', 'approve.js') + '" ';
    assert.equal(G.isApproveCommand(approve + 'vault-delete "allow delete n.md --host antigravity"'), true);
    assert.equal(G.isApproveCommand(approve + '--host codex vault-delete "yes"'), true);
    assert.equal(G.isApproveCommand(approve + '--host antigravity vault-delete "yes"'), false);
  });
  console.log('PASS antigravity: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL antigravity after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
