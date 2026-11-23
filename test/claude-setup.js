'use strict';
// Double-click route for the Claude desktop app: setup.js (claude host) --hooks user writes Continuum's hook
// entries into Claude's user settings.json (CLAUDE_CONFIG_DIR in a temp folder), merged with foreign keys and
// hooks; idempotent; a moved program folder replaces old entries; --remove keeps the rest; invalid JSON is left
// alone; dated copies; status lines. A plain setup.js run (the plugin route) still writes no hooks.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
// The real path: on a Mac the temporary folder sits behind a link (/var is /private/var), and setup writes real paths.
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-claudesetup-')));
const home = path.join(temp, 'home');
const claudeDir = path.join(temp, 'claude');
const settings = path.join(claudeDir, 'settings.json');
const vault = path.join(temp, 'My Vault');
const copies = path.join(home, '.continuum', 'claude-settings-copies');
const env = { ...process.env, USERPROFILE: home, HOME: home, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: path.join(temp, 'codex') };
delete env.CONTINUUM_CONFIG; delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_HOST;
const answers = ['--person', 'Sample Person', '--vault', vault, '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--allow-folder', 'no'];
let checks = 0;
function run(name, args, expected = 0, from = root) {
  const r = spawnSync(process.execPath, [path.join(from, 'scripts', name + '.js'), ...args], { cwd: temp, env, encoding: 'utf8', timeout: 15000 });
  assert.ifError(r.error); assert.equal(r.status, expected, r.stderr + r.stdout);
  return r.stdout + r.stderr;
}
const read = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
const entries = data => Object.entries(data.hooks || {}).flatMap(([e, gs]) => gs.flatMap(g => g.hooks.map(h => ({ e, m: g.matcher, h }))));
const slash = p => p.split(path.sep).join('/');
const foreign = { permissions: { allow: ['Bash(ls)'], deny: ['Read(./secret)'] }, enabledPlugins: { 'other@market': true }, model: 'sample-model',
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other-stop' }] }],
    Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'echo other-note' }] }] } };
function step(name, fn) { fn(); checks++; console.log('PASS claude-setup ' + checks + ': ' + name); }
try {
  step('a plain setup run (the plugin route) writes no hooks and no settings file', () => {
    const out = run('setup', answers);
    assert(!/Claude hooks/.test(out)); assert(!fs.existsSync(settings));
    assert(fs.existsSync(path.join(home, '.continuum', 'config.json')) && fs.existsSync(path.join(vault, 'START HERE.md')));
    assert(!/claude hooks/.test(run('status', [])), 'status says nothing about hooks that are not expected');
  });
  step('fresh settings file: six exec-form entries from hooks/hooks.json with absolute node and program paths', () => {
    const out = run('setup', [...answers, '--hooks', 'user']);
    assert.match(out, /Claude hooks written: .*settings\.json \(6 Continuum hook\(s\); 0 other hook\(s\) kept\)/);
    const template = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
    const data = read();
    assert.deepEqual(Object.keys(data), ['hooks']);
    assert.deepEqual(Object.keys(data.hooks), Object.keys(template));
    for (const [event, groups] of Object.entries(template)) groups.forEach((g, i) => {
      assert.equal(data.hooks[event][i].matcher, g.matcher);
      g.hooks.forEach((h, j) => assert.deepEqual(data.hooks[event][i].hooks[j], { type: 'command', command: process.execPath,
        args: [h.args[0].replace('${CLAUDE_PLUGIN_ROOT}', slash(root))], timeout: h.timeout }));
    });
    for (const { h } of entries(data)) assert(fs.existsSync(h.args[0]) && path.isAbsolute(h.command));
  });
  step('the written hook line really runs: SessionStart stdin gives the start page and the standing rules back', () => {
    const h = read().hooks.SessionStart[0].hooks[0];
    const e2 = { ...env }; delete e2.CLAUDE_PLUGIN_ROOT;
    const r = spawnSync(h.command, h.args, { cwd: vault, env: e2, encoding: 'utf8', timeout: 15000,
      input: JSON.stringify({ session_id: 's1', hook_event_name: 'SessionStart', source: 'startup', cwd: vault }) });
    assert.equal(r.status, 0, r.stderr);
    const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /# START HERE/); assert.match(text, /\[continuum\] Standing rules\s+1\. Plan/);
  });
  step('a second run rewrites nothing and makes no copy', () => {
    const before = fs.readFileSync(settings); const stat = fs.statSync(settings).mtimeMs;
    assert.match(run('setup', [...answers, '--hooks', 'user']), /Claude hooks unchanged/);
    assert(fs.readFileSync(settings).equals(before)); assert.equal(fs.statSync(settings).mtimeMs, stat);
    assert(!fs.existsSync(copies));
  });
  step('merge into a file with foreign keys and hooks: all kept, a dated copy made, then idempotent', () => {
    fs.writeFileSync(settings, JSON.stringify(foreign, null, 4));
    const before = fs.readFileSync(settings, 'utf8');
    assert.match(run('setup', [...answers, '--hooks', 'user']), /6 Continuum hook\(s\); 2 other hook\(s\) kept\)[\s\S]*kept at .*settings-\d{8}-\d{6}\.json/);
    const data = read();
    for (const k of ['permissions', 'enabledPlugins', 'model']) assert.deepEqual(data[k], foreign[k], k);
    assert.deepEqual(data.hooks.Notification, foreign.hooks.Notification);
    assert.deepEqual(data.hooks.Stop[0], foreign.hooks.Stop[0], 'the foreign Stop hook stays first');
    assert.equal(entries(data).length, 8);
    const kept = fs.readdirSync(copies);
    assert.equal(kept.length, 1); assert.equal(fs.readFileSync(path.join(copies, kept[0]), 'utf8'), before);
    assert.match(run('setup', [...answers, '--hooks', 'user']), /unchanged/); assert.equal(fs.readdirSync(copies).length, 1);
    assert(!fs.readdirSync(claudeDir).some(f => f.endsWith('.tmp')), 'no temporary file left');
  });
  step('--allow-folder yes adds the vault to the allowed folders and keeps every other permission', () => {
    run('setup', [...answers.slice(0, -1), 'yes', '--hooks', 'user']);
    const data = read();
    assert.deepEqual(data.permissions.allow, foreign.permissions.allow); assert.deepEqual(data.permissions.deny, foreign.permissions.deny);
    assert.deepEqual(data.permissions.additionalDirectories, [vault]); assert.equal(entries(data).length, 8);
  });
  step('a moved program folder (or another node path) replaces the old entries instead of adding more', () => {
    const moved = path.join(temp, 'continuum-moved');
    for (const n of ['scripts', 'hooks', 'vault-skeleton']) fs.cpSync(path.join(root, n), path.join(moved, n), { recursive: true });
    const data = read();
    data.hooks.Stop.push({ hooks: [{ type: 'command', command: 'node', args: ['C:/Old/Continuum/scripts/session-digest.js'], timeout: 8 }] });
    fs.writeFileSync(settings, JSON.stringify(data));
    assert.match(run('setup', [...answers, '--hooks', 'user'], 0, moved), /6 Continuum hook\(s\); 2 other hook\(s\) kept/);
    const after = entries(read());
    assert.equal(after.length, 8);
    const mine = after.filter(x => x.h.args);
    assert.equal(mine.length, 6); for (const x of mine) assert(x.h.args[0].startsWith(slash(moved) + '/scripts/'), x.h.args[0]);
    fs.rmSync(moved, { recursive: true });
    assert.match(run('status', ['--guided'], 1), /FAIL claude hooks: 6 Continuum hook\(s\).*missing script/);
    run('setup', [...answers, '--hooks', 'user']);
  });
  step('status: read-only PASS lines for the settings file, the hooks, their scripts and node', () => {
    const before = fs.readFileSync(settings, 'utf8');
    const out = run('status', ['--guided']);
    assert.match(out, /PASS claude settings .*settings\.json readable/);
    assert.match(out, /PASS claude hooks: 6 Continuum hook\(s\) in .*, every script exists/);
    assert.match(out, /PASS claude hooks node: .* exists/);
    assert.equal(fs.readFileSync(settings, 'utf8'), before);
    console.log(out.trim().split('\n').map(l => '    ' + l).join('\n'));
  });
  step('--remove takes out only Continuum entries, keeps the file and every other key, makes a copy', () => {
    const n = fs.readdirSync(copies).length;
    const out = run('setup', ['--remove']);
    assert.match(out, /Removed Continuum hooks from .*everything else in it kept/); assert.match(out, /vault and the config are left untouched/);
    const data = read();
    assert.deepEqual(data.hooks, foreign.hooks); assert.equal(data.model, 'sample-model'); assert.deepEqual(data.enabledPlugins, foreign.enabledPlugins);
    assert.equal(fs.readdirSync(copies).length, n + 1);
    assert.match(run('setup', ['--remove']), /No Continuum hooks in/);
    assert.match(run('status', ['--guided'], 1), /FAIL claude hooks: none in/);
    assert(!/FAIL/.test(run('status', [])), 'without --guided a settings file with no Continuum hooks is not judged');
    // A file that held only Continuum hooks keeps existing, without its empty hooks key.
    fs.writeFileSync(settings, '{}');
    run('setup', [...answers, '--hooks', 'user']); run('setup', ['--remove']);
    assert.deepEqual(read(), {});
  });
  step('a settings file that is not valid JSON, or not an object, is left alone with a plain sentence', () => {
    for (const bad of ['{"hooks": [', '[1,2]', '{"hooks": []}']) {
      fs.writeFileSync(settings, bad);
      const n = fs.existsSync(copies) ? fs.readdirSync(copies).length : 0;
      assert.match(run('setup', [...answers, '--hooks', 'user'], 1), /could not be read as settings .* so it was left alone/);
      assert.match(run('setup', ['--remove'], 1), /left alone/);
      assert.equal(fs.readFileSync(settings, 'utf8'), bad); assert.equal(fs.readdirSync(copies).length, n);
      assert.match(run('status', ['--guided'], 1), /FAIL claude settings .* cannot be read/);
    }
    run('setup', [...answers, '--hooks', 'bogus'], 1);
  });
  console.log('PASS claude-setup: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL claude-setup after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}
