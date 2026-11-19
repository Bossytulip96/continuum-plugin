'use strict';
// The double-click Codex setup, scripted through stdin with a temp USERPROFILE and CODEX_HOME.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const { STEPS, steps } = require('../scripts/lib/guided');
let temp;
let checks = 0;
function fresh() {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-guided-'));
  // CONTINUUM_DESKTOP keeps the Desktop shortcut inside the temp profile, never on the real Desktop.
  const env = { ...process.env, USERPROFILE: temp, HOME: temp, CODEX_HOME: path.join(temp, '.codex'), CLAUDE_CONFIG_DIR: path.join(temp, '.claude'),
    CONTINUUM_DESKTOP: path.join(temp, 'Desktop') };
  delete env.CONTINUUM_CONFIG; delete env.CONTINUUM_HOST; delete env.CONTINUUM_DEBUG;
  return env;
}
function guided(env, lines, args = [], script = path.join(root, 'scripts', 'guided-setup.js'), host = 'codex') {
  const r = spawnSync(process.execPath, [script, '--host', host, ...args], { env, input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 60000 });
  assert.ifError(r.error);
  assert(!/\n\s+at .+:\d+:\d+/.test(r.stdout + r.stderr), 'no stack trace: ' + r.stdout + r.stderr);
  return r;
}
const tree = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
const snapshot = dir => Object.fromEntries(tree(dir).map(f => [f, fs.readFileSync(f).toString('base64')]));
function step(name, fn) { const env = fresh(); try { fn(env); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  checks++; console.log('PASS guided ' + checks + ': ' + name); }
try {
  step('happy path with every default: permanent copy, config, notes with 13 templates, hooks on the copy, AGENTS.md, Desktop shortcut, six steps', env => {
    const r = guided(env, ['Sample Person', '', '', '', '']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const perm = path.join(temp, '.codex', 'plugins', 'continuum');
    const vault = path.join(temp, 'Documents', 'Continuum');
    for (const f of ['scripts/setup.js', 'scripts/guided-setup.js', 'hooks/codex-hooks.json', 'vault-skeleton/START HERE.md', 'hermes/__init__.py',
      '.codex-plugin/plugin.json', 'Continuum Setup for Codex.cmd', 'INSTALL-CODEX.md', 'INSTALL-CLAUDE.md', 'LICENSE', 'Continuum Guide for Codex.html']) assert(fs.existsSync(path.join(perm, f)), f);
    assert(!fs.existsSync(path.join(perm, 'INSTALL.md')), 'the old install doc name is gone');
    assert(!fs.existsSync(path.join(perm, '.git')) && !fs.existsSync(path.join(perm, 'test')));
    assert(fs.existsSync(path.join(temp, '.continuum', 'codex', 'config.json')));
    assert.equal(tree(vault).filter(f => !f.includes(path.sep + '.codex' + path.sep) && !f.endsWith('AGENTS.md')).length, 13);
    assert(fs.existsSync(path.join(vault, 'AGENTS.md')));
    const hooks = fs.readFileSync(path.join(vault, '.codex', 'hooks.json'), 'utf8');
    assert(hooks.includes(perm.split(path.sep).join('/') + '/scripts/')); assert(!hooks.includes(root.split(path.sep).join('/')));
    assert.equal(STEPS.length, 6);
    const linked = process.platform === 'win32';
    steps(vault, linked).forEach((s, i) => assert(r.stdout.includes((i + 1) + '. ' + s), s));
    if (linked) assert(r.stdout.includes('In the left list click Desktop, double-click Continuum Notes, then click Select Folder. (If you do not see Continuum Notes there, your notes folder is ' + vault + '.)'), 'step 3 uses the shortcut and names the folder');
    else assert(r.stdout.includes('Go to your notes folder and click Select Folder. Your notes folder is ' + vault + '.'), 'step 3 names the notes folder');
    assert(r.stdout.includes('\n  Desktop shortcut: Continuum Notes\n'), 'summary names the shortcut');
    if (process.platform === 'win32') {
      const lnk = path.join(temp, 'Desktop', 'Continuum Notes.lnk');
      assert(fs.existsSync(lnk) && fs.statSync(lnk).size > 0, 'shortcut made in CONTINUUM_DESKTOP');
      assert(r.stdout.includes('Desktop shortcut: Continuum Notes (opens your notes folder)'), 'Done block names the shortcut');
    }
    assert(r.stdout.includes('Do not pick the folder named .continuum'), 'step 3 warns about the settings folder');
    assert.match(r.stdout, /Program folder: .*[\\/]\.codex[\\/]plugins[\\/]continuum/); assert.match(r.stdout, /The guide is here: .*[\\/]Continuum Guide for Codex\.html\r?\n/);
    // A second run (from the permanent copy now) changes no byte of the hooks file and keeps the vault.
    const before = fs.readFileSync(path.join(vault, '.codex', 'hooks.json'));
    const again = guided(env, ['Sample Person', '', '', '', ''], [], path.join(perm, 'scripts', 'guided-setup.js'));
    assert.equal(again.status, 0, again.stdout); assert.match(again.stdout, /already in/); assert.match(again.stdout, /existing Continuum notes folder/);
    assert(fs.readFileSync(path.join(vault, '.codex', 'hooks.json')).equals(before));
  });
  step('a folder holding other files is refused and the next answer is used; a bad time zone is asked again', env => {
    const foreign = path.join(temp, 'Busy Folder');
    fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'other.txt'), 'x');
    const chosen = path.join(temp, 'Notes Here');
    const r = guided(env, ['Sample Person', '"' + foreign + '"', '"' + chosen + '"', 'my-pc', 'n', 'Mars/Olympus', 'Europe/London', '']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /already holds other files/); assert.match(r.stdout, /not a time zone this computer knows/);
    assert.deepEqual(fs.readdirSync(foreign), ['other.txt']);
    assert(fs.existsSync(path.join(chosen, 'START HERE.md')));
    const cfg = JSON.parse(fs.readFileSync(path.join(temp, '.continuum', 'codex', 'config.json'), 'utf8'));
    assert.equal(cfg.timezone, 'Europe/London'); assert.equal(cfg.machine, 'my-pc');
  });
  step('an existing notes folder is kept byte for byte', env => {
    const vault = path.join(temp, 'Old Vault');
    fs.mkdirSync(vault); fs.writeFileSync(path.join(vault, 'START HERE.md'), '# START HERE\nmine\n');
    fs.mkdirSync(path.join(vault, 'Knowledge'));
    fs.writeFileSync(path.join(vault, 'Knowledge', 'Working Agreements.md'), '## Standing rules\n1. Mine.\n');
    const before = snapshot(vault);
    const r = guided(env, ['Sample Person', vault, '', '', '']);
    assert.equal(r.status, 0, r.stdout);
    const after = snapshot(vault);
    for (const [f, bytes] of Object.entries(before)) assert.equal(after[f], bytes, f);
    assert.deepEqual(Object.keys(after).filter(f => !before[f]).map(f => path.relative(vault, f)).sort(), ['.codex' + path.sep + 'hooks.json', 'AGENTS.md']);
  });
  step('n at "Go ahead?" changes nothing at all', env => {
    const before = tree(temp);
    const r = guided(env, ['Sample Person', '', '', '', 'n']);
    assert.match(r.stdout, /Nothing was changed\./); assert.deepEqual(tree(temp), before);
  });
  step('--check: plain verdict when complete, the Trust step when Codex has no trust entries; --remove needs YES', env => {
    guided(env, ['Sample Person', '', '', '', '']);
    const vault = path.join(temp, 'Documents', 'Continuum');
    const hooksFile = path.join(vault, '.codex', 'hooks.json');
    fs.writeFileSync(path.join(temp, '.codex', 'config.toml'), 'model = "x"\n');
    let r = guided(env, [], ['--check']);
    assert.match(r.stdout, /Not everything is in place yet:[\s\S]*Codex does not trust the hooks yet[\s\S]*Trust all/);
    const events = Object.entries(JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks)
      .flatMap(([e, gs]) => gs.flatMap((g, i) => g.hooks.map((_, j) => "[hooks.state.'" + hooksFile + ':' + e + ':' + i + ':' + j + "']\ntrusted_hash = \"x\"\n")));
    fs.writeFileSync(path.join(temp, '.codex', 'config.toml'), events.join('\n'));
    r = guided(env, [], ['--check']);
    assert.equal(r.stdout.trim(), 'Everything is in place.');
    const mine = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    mine.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo other' }] });
    fs.writeFileSync(hooksFile, JSON.stringify(mine));
    const before = fs.readFileSync(hooksFile, 'utf8');
    r = guided(env, ['no'], ['--remove']);
    assert.match(r.stdout, /Nothing was changed/); assert.equal(fs.readFileSync(hooksFile, 'utf8'), before);
    r = guided(env, ['YES'], ['--remove']);
    assert.match(r.stdout, /no longer run Continuum/);
    const left = Object.values(JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks).flatMap(gs => gs.flatMap(g => g.hooks.map(h => h.command)));
    assert.deepEqual(left, ['echo other']);
    assert(fs.existsSync(path.join(vault, 'START HERE.md')) && fs.existsSync(path.join(temp, '.continuum', 'codex', 'config.json')));
  });
  step('a failure is one plain sentence with the log path, no stack trace', env => {
    const vault = path.join(temp, 'Notes');
    fs.mkdirSync(path.join(temp, '.continuum', 'codex'), { recursive: true });
    fs.writeFileSync(path.join(temp, '.continuum', 'codex', 'config.json'), '{broken');
    const r = guided(env, ['Sample Person', vault, '', '', '']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Something did not work: Setting up the notes folder and the Codex hooks did not work\.\nNothing else was changed after that point\. The technical details are in .*guided-setup\.log/);
    assert(fs.readFileSync(path.join(temp, '.continuum', 'codex', 'guided-setup.log'), 'utf8').length > 0);
  });
  step('the notes folder moved by hand, then setup again with the new address: everything follows, notes untouched', env => {
    guided(env, ['Sample Person', '', '', '', '']);
    const perm = path.join(temp, '.codex', 'plugins', 'continuum');
    const oldVault = path.join(temp, 'Documents', 'Continuum');
    fs.writeFileSync(path.join(oldVault, 'notes-and-ideas', 'Move marker.md'), '# Move marker\nWritten before the move.\n');
    const before = Object.fromEntries(Object.entries(snapshot(oldVault)).map(([f, b]) => [path.relative(oldVault, f), b]));
    const newVault = path.join(temp, 'Cloud Folder', 'Continuum');
    fs.mkdirSync(path.dirname(newVault)); fs.renameSync(oldVault, newVault);
    assert.match(guided(env, [], ['--check'], path.join(perm, 'scripts', 'guided-setup.js')).stdout, /notes folder or its START HERE\.md file is missing/);
    const r = guided(env, ['Sample Person', newVault, '', '', ''], [], path.join(perm, 'scripts', 'guided-setup.js'));
    assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /existing Continuum notes folder\. It will be kept as it is/);
    const cfg = JSON.parse(fs.readFileSync(path.join(temp, '.continuum', 'codex', 'config.json'), 'utf8'));
    assert.equal(path.resolve(cfg.vault), newVault);
    assert(fs.existsSync(path.join(newVault, '.codex', 'hooks.json')));
    const after = Object.fromEntries(Object.entries(snapshot(newVault)).map(([f, b]) => [path.relative(newVault, f), b]));
    assert.deepEqual(after, before, 'notes and hooks file byte for byte');
    assert(!fs.existsSync(oldVault), 'nothing made at the old place');
    if (process.platform === 'win32') {
      const t = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK).TargetPath'],
        { encoding: 'utf8', env: { ...process.env, LNK: path.join(temp, 'Desktop', 'Continuum Notes.lnk') } });
      assert.equal(t.stdout.trim(), newVault, 'shortcut follows the move');
    }
  });
  step('a Desktop that cannot be made: setup still succeeds and says nothing about a shortcut', env => {
    fs.writeFileSync(path.join(temp, 'a-file'), 'x');
    const r = guided({ ...env, CONTINUUM_DESKTOP: path.join(temp, 'a-file', 'Desktop') }, ['Sample Person', '', '', '', '']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert(!r.stdout.includes('Desktop shortcut: Continuum Notes (opens'), r.stdout);
    assert(!fs.existsSync(path.join(temp, 'a-file', 'Desktop')));
    const vault = path.join(temp, 'Documents', 'Continuum');
    steps(vault, false).forEach((s, i) => assert(r.stdout.includes((i + 1) + '. ' + s), s));
    assert(r.stdout.includes('Go to your notes folder and click Select Folder. Your notes folder is ' + vault + '.'), 'no shortcut: step 3 names the folder');
  });
  const { render, SOURCE, TARGET } = require('../scripts/build-guide');
  // The zip carries only the HTML guide (GUIDE-CODEX.md is export-ignore), so there is nothing to compare there.
  if (!fs.existsSync(SOURCE)) console.log('SKIP guided: HTML guide check, GUIDE-CODEX.md is not here (an unzipped copy carries only the HTML)');
  else step('the committed HTML guide is what scripts/build-guide.js makes from GUIDE-CODEX.md', () => {
    const lf = text => text.replace(/\r\n/g, '\n');
    const made = render(lf(fs.readFileSync(SOURCE, 'utf8')));
    assert.equal(lf(fs.readFileSync(TARGET, 'utf8')), made, 'run node scripts/build-guide.js');
    const html = render('# T\n\n1. a **b**\n   - c `d`\n     e\n2. f\n');
    assert(html.includes('<ol>\n<li>a <strong>b</strong>\n<ul>\n<li>c <code>d</code> e</li>\n</ul>\n</li>\n<li>f</li>\n</ol>'), html);
    assert(!/\*\*|`|<script|https?:/.test(made.replace(/<code>[^<]*<\/code>/g, '')));
  });
  step('the three .cmd files are ASCII with CRLF and run scripts that exist', () => {
    for (const name of ['Continuum Setup for Codex.cmd', 'Continuum Check for Codex.cmd', 'Continuum Remove for Codex.cmd']) {
      const bytes = fs.readFileSync(path.join(root, name));
      assert(bytes.every(b => b < 128), name + ' ASCII');
      const text = bytes.toString('ascii');
      assert(!/[^\r]\n/.test(text) && text.includes('\r\n'), name + ' CRLF');
      const m = text.match(/node "%~dp0([^"]+)" --host codex/);
      assert(m && fs.existsSync(path.join(root, m[1].split('\\').join(path.sep))), name);
      assert.match(text, /pause\r\n$/); assert.match(text, /nodejs\.org/);
    }
  });
  // The Claude desktop app (--host claude): program in .continuum\program, hooks in Claude's settings.json.
  const claude = (env, lines, args = [], script) => guided(env, lines, args, script, 'claude');
  const { claudeSteps } = require('../scripts/lib/guided');
  const foreign = { permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'other@market': true },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other-stop' }] }] } };
  const settingsOf = () => JSON.parse(fs.readFileSync(path.join(temp, '.claude', 'settings.json'), 'utf8'));
  const ourArgs = data => Object.values(data.hooks || {}).flatMap(gs => gs.flatMap(g => g.hooks)).filter(h => h.args).map(h => h.args[0]);
  function claudeSetup(env) {
    fs.mkdirSync(path.join(temp, '.claude'));
    fs.writeFileSync(path.join(temp, '.claude', 'settings.json'), JSON.stringify(foreign));
    return claude(env, ['Sample Person', '', '', '', '']);
  }
  step('claude: happy path from piped answers: program copy, config, notes, hooks merged into settings.json, Done, four steps', env => {
    const r = claudeSetup(env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const perm = path.join(temp, '.continuum', 'program');
    const vault = path.join(temp, 'Documents', 'Continuum');
    for (const f of ['scripts/setup.js', 'hooks/hooks.json', 'Continuum Setup for Claude.cmd', 'Continuum Check for Claude.cmd',
      'Continuum Remove for Claude.cmd', 'Continuum Guide for Claude.html', 'INSTALL-CLAUDE.md']) assert(fs.existsSync(path.join(perm, f)), f);
    assert(!fs.existsSync(path.join(perm, 'test')) && !fs.existsSync(path.join(perm, '.git')));
    const cfg = JSON.parse(fs.readFileSync(path.join(temp, '.continuum', 'config.json'), 'utf8'));
    assert.match(cfg.machine, /-claude$/); assert.equal(path.resolve(cfg.vault), vault);
    assert(fs.existsSync(path.join(vault, 'START HERE.md')) && !fs.existsSync(path.join(vault, '.codex')));
    const data = settingsOf();
    assert.deepEqual(data.enabledPlugins, foreign.enabledPlugins); assert.deepEqual(data.permissions.allow, foreign.permissions.allow);
    assert.deepEqual(data.permissions.additionalDirectories, [vault]); assert.deepEqual(data.hooks.Stop[0], foreign.hooks.Stop[0]);
    const args = ourArgs(data);
    assert.equal(args.length, 6); for (const a of args) assert(a.startsWith(perm.split(path.sep).join('/') + '/scripts/') && fs.existsSync(a), a);
    assert(r.stdout.includes('And it changes Claude\'s own settings file'), 'the opening says Claude\'s settings file changes');
    assert.match(r.stdout, /Done\. Continuum is set up:/); assert.match(r.stdout, /Copy of it as it was: /);
    assert.match(r.stdout, /4 steps are left, in the Claude app:/);
    claudeSteps(vault, process.platform === 'win32').forEach((s, i) => assert(r.stdout.includes((i + 1) + '. ' + s), s));
    assert.match(r.stdout, /The guide is here: .*[\\/]\.continuum[\\/]program[\\/]Continuum Guide for Claude\.html\r?\n/);
    assert(!fs.existsSync(path.join(temp, '.codex')), 'nothing for Codex');
    const before = fs.readFileSync(path.join(temp, '.claude', 'settings.json'));
    const again = claude(env, ['Sample Person', '', '', '', ''], [], path.join(perm, 'scripts', 'guided-setup.js'));
    assert.equal(again.status, 0, again.stdout); assert.match(again.stdout, /already in/);
    assert(fs.readFileSync(path.join(temp, '.claude', 'settings.json')).equals(before), 'second run rewrites nothing');
  });
  step('claude: --check says Everything is in place, then names the missing hook lines; --remove needs YES and keeps the rest', env => {
    claudeSetup(env);
    const file = path.join(temp, '.claude', 'settings.json');
    let r = claude(env, [], ['--check']);
    assert.equal(r.stdout.trim(), 'Everything is in place.');
    const before = fs.readFileSync(file, 'utf8');
    r = claude(env, [''], ['--remove']);
    assert.match(r.stdout, /Nothing was changed/); assert.equal(fs.readFileSync(file, 'utf8'), before);
    r = claude(env, ['YES'], ['--remove']);
    assert.match(r.stdout, /removes only Continuum's hook lines from Claude's settings file/);
    assert.match(r.stdout, /Done\. The Claude app will no longer run Continuum\. Your notes and settings are still there\./);
    const data = settingsOf();
    assert.deepEqual(data.hooks, foreign.hooks); assert.deepEqual(data.enabledPlugins, foreign.enabledPlugins);
    assert(fs.existsSync(path.join(temp, 'Documents', 'Continuum', 'START HERE.md')) && fs.existsSync(path.join(temp, '.continuum', 'config.json')));
    r = claude(env, [], ['--check']);
    assert.match(r.stdout, /Not everything is in place yet:\n  - Claude's settings file is missing Continuum's hook lines[\s\S]*"Continuum Setup for Claude" again/);
    assert.match(claude(env, ['YES'], ['--remove']).stdout, /no Continuum hook lines to remove/);
  });
  step('claude: a settings.json that is not valid JSON is left alone and the failure is one plain sentence', env => {
    fs.mkdirSync(path.join(temp, '.claude'));
    fs.writeFileSync(path.join(temp, '.claude', 'settings.json'), '{ not json');
    const r = claude(env, ['Sample Person', '', '', '', '']);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /Something did not work: Claude's settings file could not be read, so it was left alone and Continuum's hook lines were not added\.\n.*guided-setup\.log/);
    assert.equal(fs.readFileSync(path.join(temp, '.claude', 'settings.json'), 'utf8'), '{ not json');
    assert(fs.existsSync(path.join(temp, '.continuum', 'guided-setup.log')));
  });
  step('claude: the three .cmd files are ASCII with CRLF, like the Codex ones, and run scripts that exist', () => {
    for (const kind of ['Setup', 'Check', 'Remove']) {
      const text = fs.readFileSync(path.join(root, 'Continuum ' + kind + ' for Claude.cmd'));
      assert(text.every(b => b < 128));
      const codex = fs.readFileSync(path.join(root, 'Continuum ' + kind + ' for Codex.cmd'), 'ascii');
      assert.equal(text.toString('ascii'), codex.replace('for Codex', 'for Claude').replace('--host codex', '--host claude'), kind);
      const m = text.toString('ascii').match(/node "%~dp0([^"]+)" --host claude/);
      assert(m && fs.existsSync(path.join(root, m[1].split('\\').join(path.sep))));
    }
  });
  const G2 = require('../scripts/build-guide').GUIDES[1];
  if (!fs.existsSync(G2.source)) console.log('SKIP guided: Claude HTML guide check, GUIDE-CLAUDE.md is not here');
  else step('claude: the committed Claude HTML guide is what scripts/build-guide.js makes from GUIDE-CLAUDE.md', () => {
    const lf = text => text.replace(/\r\n/g, '\n');
    const made = render(lf(fs.readFileSync(G2.source, 'utf8')), G2.title);
    assert.equal(lf(fs.readFileSync(G2.target, 'utf8')), made, 'run node scripts/build-guide.js');
    assert(!/NAMES NOT YET CHECKED|<!--|\*\*|<script|https?:/.test(made.replace(/<code>[^<]*<\/code>/g, '')));
    for (const s of claudeSteps()) assert(made.replace(/<\/?strong>/g, '').replace(/\s+/g, ' ').includes(s.split('.')[0]), s);
  });
  console.log('PASS guided: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL guided after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
}
