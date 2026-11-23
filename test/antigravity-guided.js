'use strict';
// The double-click setup for Google Antigravity ("Continuum Setup for Antigravity.cmd", --host antigravity),
// scripted through stdin with a temp USERPROFILE: the program folder goes into <profile>\.gemini\config\plugins.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const { antigravitySteps, ANTIGRAVITY_STEPS } = require('../scripts/lib/guided');
// On a Mac the end screen speaks in the Mac words of the app, the notes folder is suggested in the home folder, and the Desktop shortcut is a link.
const MAC = process.platform === 'darwin';
const shown = MAC ? require('../scripts/lib/guided-mac-steps').antigravitySteps : antigravitySteps;
const GUIDE = MAC ? ' on a Mac' : ''; // the end screen points at the Mac guide on a Mac
const START = MAC ? 'Run' : 'Double-click'; // on a Mac a setup file is run from Terminal
let temp;
let checks = 0;
function fresh() {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'continuum-ag-guided-'));
  const env = { ...process.env, USERPROFILE: temp, HOME: temp, CODEX_HOME: path.join(temp, '.codex'), CLAUDE_CONFIG_DIR: path.join(temp, '.claude'),
    CONTINUUM_DESKTOP: path.join(temp, 'Desktop') };
  delete env.CONTINUUM_CONFIG; delete env.CONTINUUM_HOST; delete env.CONTINUUM_DEBUG; delete env.CONTINUUM_GEMINI_HOME;
  return env;
}
function guided(env, lines, args = [], script = path.join(root, 'scripts', 'guided-setup.js'), host = 'antigravity') {
  const r = spawnSync(process.execPath, [script, '--host', host, ...args], { env, input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 60000 });
  assert.ifError(r.error);
  assert(!/\n\s+at .+:\d+:\d+/.test(r.stdout + r.stderr), 'no stack trace: ' + r.stdout + r.stderr);
  return r;
}
const tree = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? tree(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
function step(name, fn) { const env = fresh(); try { fn(env); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  checks++; console.log('PASS antigravity-guided ' + checks + ': ' + name); }
const perm = () => path.join(temp, '.gemini', 'config', 'plugins', 'continuum');
const notes = () => MAC ? path.join(temp, 'Continuum') : path.join(temp, 'Documents', 'Continuum');
const answers = ['Sample Person', '', '', '', ''];
try {
  step('happy path with every default: the program folder is a plugin in Antigravity\'s plugins folder, config, notes, shortcut, three steps, and its hook runs', env => {
    const r = guided(env, answers);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ['.antigravity-plugin/plugin.json', 'hooks.json', 'rules/AGENTS.md', 'scripts/antigravity-hook.js', 'scripts/guided-setup.js', 'skills/continuum-status/SKILL.md',
      'vault-skeleton/START HERE.md', 'Continuum Setup for Antigravity.cmd', 'Continuum Check for Antigravity.cmd', 'Continuum Remove for Antigravity.cmd',
      'Continuum Guide for Antigravity.html', 'Continuum Setup for Antigravity.command', 'Continuum Guide for Antigravity on a Mac.html',
      'INSTALL-ANTIGRAVITY.md', 'LICENSE']) assert(fs.existsSync(path.join(perm(), f)), f);
    assert(!fs.existsSync(path.join(perm(), '.git')) && !fs.existsSync(path.join(perm(), 'test')));
    const cfg = JSON.parse(fs.readFileSync(path.join(temp, '.continuum', 'antigravity', 'config.json'), 'utf8'));
    assert.match(cfg.machine, /-antigravity$/); assert.equal(path.resolve(cfg.vault), notes());
    assert.equal(tree(notes()).length, 13, 'only the 13 starter notes, nothing else in the notes folder');
    assert(!fs.existsSync(path.join(temp, '.gemini', 'config', 'hooks.json')), 'no global hooks file');
    assert(!fs.existsSync(path.join(temp, '.codex')) && !fs.existsSync(path.join(temp, '.claude')), 'nothing for Codex or Claude');
    assert(r.stdout.includes('This sets up Continuum, a notes memory for Google Antigravity.'));
    assert.match(r.stdout, /Done\. Continuum is set up:/); assert.match(r.stdout, /3 steps are left, in Antigravity:/);
    assert.equal(ANTIGRAVITY_STEPS.length, 3);
    shown(notes(), process.platform === 'win32' || MAC).forEach((s, i) => assert(r.stdout.includes((i + 1) + '. ' + s), s));
    assert(r.stdout.includes('Do not pick the folder named .continuum'), 'step 2 warns about the settings folder');
    assert.match(r.stdout, /Program folder: .*[\\/]\.gemini[\\/]config[\\/]plugins[\\/]continuum/);
    assert.match(r.stdout, new RegExp('The guide is here: .*[\\\\/]plugins[\\\\/]continuum[\\\\/]Continuum Guide for Antigravity' + GUIDE + '\\.html\\r?\\n'));
    if (process.platform === 'win32') assert(fs.existsSync(path.join(temp, 'Desktop', 'Continuum Notes.lnk')), 'shortcut made in CONTINUUM_DESKTOP');
    if (MAC) assert.equal(fs.readlinkSync(path.join(temp, 'Desktop', 'Continuum Notes')), notes(), 'link made in CONTINUUM_DESKTOP');
    // The installed plugin's own hook line, started the way Antigravity starts it: from the plugin folder.
    const hook = spawnSync(process.execPath, ['./scripts/antigravity-hook.js', 'SessionStart'], { cwd: perm(), env, encoding: 'utf8', timeout: 15000,
      input: JSON.stringify({ conversationId: 'c1', workspacePaths: [], modelName: 'sample' }) });
    assert.equal(hook.status, 0, hook.stderr);
    const text = (JSON.parse(hook.stdout).injectSteps || []).map(s => s.systemMessage.systemMessage).join('\n');
    assert(text.includes('[continuum]') && text.includes(notes()), 'the start text names the notes folder');
    const again = guided(env, answers, [], path.join(perm(), 'scripts', 'guided-setup.js'));
    assert.equal(again.status, 0, again.stdout); assert.match(again.stdout, /already in/); assert.match(again.stdout, /existing Continuum notes folder/);
  });
  step('the Codex program folder gets no top-level hooks.json, plugin manifest or rules from the Antigravity plugin', env => {
    const r = guided(env, answers, [], undefined, 'codex');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const codex = path.join(temp, '.codex', 'plugins', 'continuum');
    for (const f of ['hooks.json', '.antigravity-plugin', 'rules']) assert(!fs.existsSync(path.join(codex, f)), f);
    assert(fs.existsSync(path.join(codex, 'INSTALL-ANTIGRAVITY.md')) && !fs.existsSync(path.join(temp, '.gemini')));
  });
  step('--check: Everything is in place; a damaged hooks file, a missing program folder and a double install are each named in plain words', env => {
    guided(env, answers);
    let r = guided(env, [], ['--check']);
    assert.equal(r.stdout.trim(), 'Everything is in place.');
    const setup = spawnSync(process.execPath, [path.join(perm(), 'scripts', 'setup.js'), '--host', 'antigravity', '--person', 'Sample Person', '--vault', notes(),
      '--machine', 'sample', '--timezone', 'UTC', '--autonomy', 'ask', '--hooks', 'global'], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(setup.status, 0, setup.stdout + setup.stderr);
    r = guided(env, [], ['--check']);
    assert.match(r.stdout, /Not everything is in place yet:\n  - Continuum is in Antigravity twice[\s\S]*"Continuum Remove for Antigravity", then "Continuum Setup for Antigravity"/);
    fs.rmSync(path.join(temp, '.gemini', 'config', 'hooks.json'));
    fs.writeFileSync(path.join(perm(), 'hooks.json'), '{ not json');
    r = guided(env, [], ['--check']);
    assert(r.stdout.includes('The hooks file in Continuum\'s program folder is missing, damaged or turned off. ' + START + ' "Continuum Setup for Antigravity" again.'), r.stdout);
    fs.rmSync(perm(), { recursive: true, force: true });
    r = guided(env, [], ['--check']);
    assert.match(r.stdout, /Continuum's program folder is missing from Antigravity's plugins folder, or it is incomplete\./);
  });
  step('--remove needs YES, takes out the program folder and a global hook group, keeps notes and settings, and says so when there is nothing to remove', env => {
    guided(env, answers);
    const globalFile = path.join(temp, '.gemini', 'config', 'hooks.json');
    fs.writeFileSync(globalFile, JSON.stringify({ other: { Stop: [{ type: 'command', command: 'echo other' }] }, continuum: { Stop: [{ type: 'command', command: 'node "x/scripts/antigravity-hook.js" Stop' }] } }));
    let r = guided(env, [''], ['--remove']);
    assert.match(r.stdout, /Nothing was changed/); assert(fs.existsSync(path.join(perm(), 'hooks.json')));
    r = guided(env, ['YES'], ['--remove'], path.join(perm(), 'scripts', 'guided-setup.js'));
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /Something did not work: This file was opened from the program folder itself, which cannot remove itself\. Open "Continuum Remove for Antigravity" from the Continuum folder you unzipped instead\./);
    assert(fs.existsSync(path.join(perm(), 'hooks.json')), 'left alone');
    r = guided(env, ['YES'], ['--remove']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Done\. Antigravity will no longer run Continuum\. Your notes and settings are still there\./);
    assert(!fs.existsSync(perm()), 'program folder gone');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(globalFile, 'utf8'))), ['other'], 'only the Continuum group left the global hooks file');
    assert(fs.existsSync(path.join(notes(), 'START HERE.md')) && fs.existsSync(path.join(temp, '.continuum', 'antigravity', 'config.json')));
    assert.match(guided(env, ['YES'], ['--remove']).stdout, /Continuum was not in Antigravity\. Nothing was changed\./);
  });
  step('--remove leaves a folder alone that does not hold Continuum\'s plugin manifest', env => {
    fs.mkdirSync(perm(), { recursive: true }); fs.writeFileSync(path.join(perm(), 'mine.txt'), 'x');
    const r = guided(env, ['YES'], ['--remove']);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /does not look like Continuum's program folder, so it was left alone\./);
    assert.deepEqual(fs.readdirSync(perm()), ['mine.txt']);
  });
  step('setup refuses a notes folder inside the program folder and takes the next answer; a program folder that holds other files is left alone', env => {
    let r = guided(env, ['Sample Person', path.join(perm(), 'Notes'), '', '', '', '']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /That folder belongs to Continuum's own program or settings\. Please pick a different folder for your notes\./);
    assert(fs.existsSync(path.join(notes(), 'START HERE.md')) && !fs.existsSync(path.join(perm(), 'Notes')));
    fs.rmSync(perm(), { recursive: true, force: true });
    fs.mkdirSync(perm(), { recursive: true }); fs.writeFileSync(path.join(perm(), 'README.md'), 'mine'); fs.writeFileSync(path.join(perm(), 'mine.txt'), 'x');
    r = guided(env, answers);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /already holds other files, so the Continuum program was not copied there\./);
    assert.deepEqual(fs.readdirSync(perm()).sort(), ['README.md', 'mine.txt']); assert.equal(fs.readFileSync(path.join(perm(), 'README.md'), 'utf8'), 'mine');
  });
  step('--remove removes nothing when the settings name a notes folder inside the program folder', env => {
    guided(env, answers);
    const inside = path.join(perm(), 'Notes');
    fs.mkdirSync(inside); fs.writeFileSync(path.join(inside, 'START HERE.md'), '# mine\n');
    const cfgFile = path.join(temp, '.continuum', 'antigravity', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); cfg.vault = inside; fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    const r = guided(env, ['YES'], ['--remove']);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /Your notes folder or Continuum's settings are inside the program folder .* so nothing was removed\./);
    assert.equal(fs.readFileSync(path.join(inside, 'START HERE.md'), 'utf8'), '# mine\n'); assert(fs.existsSync(path.join(perm(), 'hooks.json')));
    // A settings file that cannot be read, or one named by CONTINUUM_CONFIG, never lets the notes go either.
    fs.writeFileSync(cfgFile, '{ broken');
    const broken = guided(env, ['YES'], ['--remove']);
    assert.equal(broken.status, 1, broken.stdout);
    assert.match(broken.stdout, /settings file .* cannot be read, so Continuum cannot tell where your notes are\. Nothing was removed\./);
    assert(fs.existsSync(path.join(inside, 'START HERE.md')));
    const other = path.join(temp, 'other-config.json');
    fs.writeFileSync(other, JSON.stringify({ ...cfg, vault: path.join(temp, 'Elsewhere') }));
    const marked = guided({ ...env, CONTINUUM_CONFIG: other }, ['YES'], ['--remove']);
    assert.equal(marked.status, 1, marked.stdout);
    assert.match(marked.stdout, /are inside the program folder .* so nothing was removed\./);
    assert(fs.existsSync(path.join(inside, 'START HERE.md')), 'a folder that looks like notes is never removed, whatever the settings say');
    // However deep the notes sit: every folder is looked at (a link to a folder is not followed, and removing it leaves its target).
    fs.rmSync(inside, { recursive: true, force: true });
    const deep = path.join(perm(), 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
    fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'START HERE.md'), '# deep\n');
    const far = guided({ ...env, CONTINUUM_CONFIG: other }, ['YES'], ['--remove']);
    assert.equal(far.status, 1, far.stdout); assert(fs.existsSync(path.join(deep, 'START HERE.md')), 'deep notes stay');
  });
  step('--check names Antigravity\'s own hooks file when that file cannot be read; a write to a workspace plugin\'s hooks.json asks first; two copies in one second get two names', env => {
    guided(env, answers);
    const globalFile = path.join(temp, '.gemini', 'config', 'hooks.json');
    fs.writeFileSync(globalFile, '{ not json');
    const r = guided(env, [], ['--check']);
    assert.match(r.stdout, /Antigravity's own hooks file cannot be read: .*hooks\.json\. Continuum's setup file does not write to that file/);
    assert(!/program folder is missing, damaged/.test(r.stdout), r.stdout);
    fs.rmSync(globalFile);
    const hook = spawnSync(process.execPath, ['./scripts/antigravity-hook.js', 'PreToolUse'], { cwd: perm(), env, encoding: 'utf8', timeout: 15000,
      input: JSON.stringify({ conversationId: 'c1', workspacePaths: [notes()], stepIdx: 1,
        toolCall: { name: 'write_file', args: { Path: path.join(notes(), '.agents', 'plugins', 'continuum', 'hooks.json'), Content: '{}', Overwrite: true } } }) });
    const out = JSON.parse(hook.stdout);
    assert.equal(out.decision, 'force_ask', hook.stdout); assert.match(out.reason, /system-change/);
    const S = require('../scripts/lib/antigravity-setup');
    fs.writeFileSync(globalFile, JSON.stringify({ continuum: {}, other: {} }));
    const first = S.uninstall(globalFile);
    fs.writeFileSync(globalFile, JSON.stringify({ continuum: {}, other: {} }));
    const second = S.uninstall(globalFile);
    const copies = fs.readdirSync(path.dirname(globalFile)).filter(n => /^hooks\.json\.bak-/.test(n));
    assert.equal(copies.length, 2, copies.join(', ') + ' | ' + first + ' | ' + second);
  });
  step('the three .cmd files are the Codex ones with the name and the host changed, and run a script that exists', () => {
    for (const kind of ['Setup', 'Check', 'Remove']) {
      const text = fs.readFileSync(path.join(root, 'Continuum ' + kind + ' for Antigravity.cmd'));
      assert(text.every(b => b < 128));
      const codex = fs.readFileSync(path.join(root, 'Continuum ' + kind + ' for Codex.cmd'), 'ascii');
      assert.equal(text.toString('ascii'), codex.replace('for Codex', 'for Antigravity').replace('--host codex', '--host antigravity'), kind);
      const m = text.toString('ascii').match(/node "%~dp0([^"]+)" --host antigravity/);
      assert(m && fs.existsSync(path.join(root, m[1].split('\\').join(path.sep))));
    }
  });
  const { render, GUIDES } = require('../scripts/build-guide');
  const guide = GUIDES.find(g => /Antigravity/.test(g.target));
  if (!fs.existsSync(guide.source)) console.log('SKIP antigravity-guided: HTML guide check, GUIDE-ANTIGRAVITY.md is not here (an unzipped copy carries only the HTML)');
  else step('the committed HTML guide is what scripts/build-guide.js makes from GUIDE-ANTIGRAVITY.md, and it quotes the three steps', () => {
    const lf = text => text.replace(/\r\n/g, '\n');
    const made = render(lf(fs.readFileSync(guide.source, 'utf8')), guide.title);
    assert.equal(lf(fs.readFileSync(guide.target, 'utf8')), made, 'run node scripts/build-guide.js');
    assert(!/<!--|\*\*|<script|https?:/.test(made.replace(/<code>[^<]*<\/code>/g, '')));
    for (const s of antigravitySteps()) assert(made.replace(/<\/?strong>/g, '').replace(/\s+/g, ' ').includes(s.split('.')[0]), s);
  });
  const macGuide = GUIDES.find(g => path.basename(g.target) === 'Continuum Guide for Antigravity on a Mac.html');
  assert(macGuide, 'scripts/build-guide.js builds the Mac guide for Antigravity');
  if (!fs.existsSync(macGuide.source)) console.log('SKIP antigravity-guided: Mac HTML guide check, GUIDE-ANTIGRAVITY-MAC.md is not here (an unzipped copy carries only the HTML)');
  else step('the committed Mac HTML guide is what scripts/build-guide.js makes from GUIDE-ANTIGRAVITY-MAC.md, and it quotes the three Mac steps', () => {
    const lf = text => text.replace(/\r\n/g, '\n');
    const made = render(lf(fs.readFileSync(macGuide.source, 'utf8')), macGuide.title);
    assert.equal(lf(fs.readFileSync(macGuide.target, 'utf8')), made, 'run node scripts/build-guide.js');
    assert(!/<!--|\*\*|`|<script|https?:/.test(made.replace(/<code>[^<]*<\/code>/g, '')));
    // Every step whole, word for word: bold and code marks off, the escaped signs back, one space between words.
    const text = made.replace(/<\/?(?:strong|code)>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    assert(!/\bPATH\b|\bshell\b|symlink|quarantine|Gatekeeper/i.test(text), 'plain words only');
    const macSteps = require('../scripts/lib/guided-mac-steps').antigravitySteps();
    assert.equal(macSteps.length, 3);
    macSteps.forEach((s, i) => assert(text.includes(s.replace(/\s+/g, ' ')), 'step ' + (i + 1) + ' is not in the guide word for word: ' + s));
  });
  console.log('PASS antigravity-guided: ' + checks + ' groups');
} catch (error) {
  console.error('FAIL antigravity-guided after ' + checks + ' groups: ' + error.stack);
  process.exitCode = 1;
}
