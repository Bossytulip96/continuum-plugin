'use strict';
// Helpers for the double-click setup (scripts/guided-setup.js), for Codex (--host codex), for the Claude
// desktop app (--host claude) and for Google Antigravity (--host antigravity): the one copy of the steps left after setup for each, the answer reader, folder
// and drive checks, the package copy, and the plain-word reading of status.js. Nothing here prints a stack trace.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const host = require('./host');
const isClaude = () => host.name() === 'claude';
const isAntigravity = () => host.name() === 'antigravity';

// The steps left after setup, in the words of the ChatGPT desktop app (Codex lives inside it).
// This list is the one source: the end screen prints it and the user guide quotes it.
// Names checked in the app on 2026-11-11 (File menu, the ChatGPT/Codex switcher, Settings > Hooks).
// Wording changed after the first from-nothing run on a second computer (2026-11-11): the person opened
// the settings folder (.continuum) instead of the notes folder, so step 3 now names the notes folder by
// its full path; the app can already be on the Codex screen; a narrow window shows pictures, not words.
// 2026-11-11, second change: the Documents button can open OneDrive's Documents, not the profile's, so step 3
// had the person paste the address. Second run, 2026-11-11: the paste did not work for the person at the screen,
// but double-clicking the Desktop shortcut Continuum Notes inside the Open Folder window did, so step 3 uses that.
// steps(vault, hasShortcut) is what the end screen prints; STEPS is the same list without a path.
const steps = (vault, hasShortcut) => [
  'In the ChatGPT app click File, then Quit ChatGPT. Then open the app again. (The X in the corner only hides the app, so use Quit.)',
  'At the top left, look at the word with the small arrow next to it. If it says ChatGPT, click it and pick Codex. If it already says Codex, go on to the next step.',
  'Click File, then Open Folder. ' + (vault && !hasShortcut
    ? 'Go to your notes folder and click Select Folder. Your notes folder is ' + vault + '.'
    : 'In the left list click Desktop, double-click Continuum Notes, then click Select Folder.' +
      (vault ? ' (If you do not see Continuum Notes there, your notes folder is ' + vault + '.)' : '')) +
    ' Do not pick the folder named .continuum with a dot in front; that one only holds settings.',
  'Hold Ctrl and press the comma key to open Settings. (Another way: click the round button with your initials at the bottom left, then Settings.) Type hooks in the search box and click Hooks. If that page does not show your notes folder, go back and open the other Hooks result. Click the row with your notes folder. If it says 6 need review, click Trust all. If it only says 6 hooks, they are already trusted from an earlier setup and there is nothing to click.',
  'Go back to the chat screen. Above the message box you should see the name of your notes folder and the words This computer. In a small window you may see two small pictures there instead of the words: a folder and a laptop. If it does not say This computer, click it and pick This computer.',
  'Type this and send it: What are my standing rules? If the answer lists rules from your notes, Continuum is working.'
];
const STEPS = steps();
// The steps left after setup in the Claude desktop app (its Code tab). There is no trust step for Claude.
// This list is the one source: the end screen prints it and GUIDE-CLAUDE.md quotes it.
// Names seen in the Claude desktop app on Windows on 2026-11-12, in screenshots from a second computer: the button
// with three lines at the top left corner opens a menu with File, and File ends with Exit; two small pictures at
// the top left, the second one drawn as </>; + New at the top of the list on the left; under the message box,
// This computer and, next to it, Choose folder, whose menu holds No folder and Open folder...; the Windows folder
// window is titled Select folder, with Desktop in its left list, the Continuum Notes shortcut and Select Folder.
// Seen on 2026-11-18 on a laptop that had used a folder before: the folder button showed that folder's name, not
// Choose folder; after Select Folder the app asked "Trust this workspace?" with Cancel and Trust workspace.
// NOT YET SEEN: that the </> picture is named Code when the mouse is held over it (the app's documentation says
// so); the choices behind This computer; whether the app must be quit for new hook lines to load, or a new
// session is enough.
const claudeSteps = (vault, hasShortcut) => [
  'Quit the Claude app completely, then open it again: click the button with three lines at the very top left corner of the Claude window, ' +
    'click File, then click Exit. (Use Exit, not the X in the corner.)',
  'At the top left of the Claude window there are two small pictures side by side. Click the one that looks like </> . That one is Code.',
  'Click + New at the top of the list on the left. Under the message box it should say This computer; if it says something else, click it and pick This computer. ' +
    'Next to it click Choose folder (if you used a folder before, the button shows that folder\'s name), then click Open folder... ' + (vault && !hasShortcut
    ? 'Go to your notes folder and click Select Folder. Your notes folder is ' + vault + '.'
    : 'In the left list click Desktop, double-click Continuum Notes, then click Select Folder.' +
      (vault ? ' (If you do not see Continuum Notes there, your notes folder is ' + vault + '.)' : '')) +
    ' Do not pick the folder named .continuum with a dot in front; that one only holds settings.' +
    ' If a box then asks Trust this workspace?, check that it names your notes folder and click Trust workspace.',
  'Type this and send it: What are my standing rules? If the answer lists rules from your notes, Continuum is working.'
];
const CLAUDE_STEPS = claudeSteps();
// The steps left after setup in the Antigravity App. There is no trust step: the program folder sits in
// Antigravity's own plugins folder, so Continuum runs in every conversation. The notes folder is made a project
// because Antigravity asks "Allow read access to this path?" before it opens a file outside a project (seen on
// the first question of a from-nothing run, 2026-11-23); inside the project a note was changed with no such box.
// This list is the one source: the end screen prints it and GUIDE-ANTIGRAVITY.md quotes it.
// Names seen in the Antigravity App 2.34.0 on Windows 11 on 2026-11-23: the menus Antigravity, Workspace, View and
// Window along the top of the window (Window holds Minimize, Maximize and Close; no menu holds Quit or Exit, and
// Close ends the program); Workspace holds New Conversation, Create Project and Command Palette; the Create
// Project box has Add Folder, then Next; the folder window is titled Open workspace, with Desktop in its left
// list, the Continuum Notes shortcut and Select Folder; after Next a new conversation opens in the project.
const antigravitySteps = (vault, hasShortcut) => [
  'If Antigravity is open, close it and open it again: at the top of the Antigravity window click Window, then click Close. Then open Antigravity again.',
  'Make your notes folder a project: click Workspace, then Create Project, then Add Folder. ' + (vault && !hasShortcut
    ? 'Go to your notes folder and click Select Folder. Your notes folder is ' + vault + '.'
    : 'In the left list click Desktop, double-click Continuum Notes, then click Select Folder.' +
      (vault ? ' (If you do not see Continuum Notes there, your notes folder is ' + vault + '.)' : '')) +
    ' Do not pick the folder named .continuum with a dot in front; that one only holds settings. Then click Next.',
  'A new conversation opens, with the name of your notes folder above the message box. Type this and send it: What are my standing rules? If the answer lists rules from your notes, Continuum is working.'
];
const ANTIGRAVITY_STEPS = antigravitySteps();
const stepsFor = (vault, hasShortcut) => { // a Mac has its own words for each app (guided-mac-steps.js)
  const s = process.platform === 'darwin' ? require('./guided-mac-steps') : { claudeSteps, antigravitySteps, steps };
  return (isClaude() ? s.claudeSteps : isAntigravity() ? s.antigravitySteps : s.steps)(vault, hasShortcut);
};
// The word that changes with the host in the .cmd file names: "Continuum Setup for Claude", "... for Codex"
// or "... for Antigravity".
const label = () => isClaude() ? 'Claude' : isAntigravity() ? 'Antigravity' : 'Codex';
const SOURCE = path.resolve(__dirname, '..', '..');
const profile = () => process.env.USERPROFILE || os.homedir();
// Antigravity: the program folder is the plugin folder itself, inside Antigravity's own plugins folder.
const permanent = () => isClaude() ? path.join(profile(), '.continuum', 'program')
  : isAntigravity() ? require('./antigravity-setup').installedDir() : path.join(profile(), '.codex', 'plugins', 'continuum');
const settingsFolder = () => isClaude() ? path.join(profile(), '.continuum') : path.join(profile(), '.continuum', label().toLowerCase());
const logFile = () => path.join(settingsFolder(), 'guided-setup.log');
// The same folder under two spellings counts as one: on a Mac /var is a link to /private/var.
// A Mac's disk is asked for its own spelling (most take Notes and notes for one folder, some do not); only
// Windows is known to ignore letter case.
const real = p => { try { return (process.platform === 'darwin' ? fs.realpathSync.native : fs.realpathSync)(p); } catch (_) { return path.resolve(p); } };
const same = (a, b) => process.platform === 'win32' ? real(a).toLowerCase() === real(b).toLowerCase() : real(a) === real(b);
const MAC = process.platform === 'darwin';
// On a Mac a setup file is run from Terminal (the Mac refuses a double-click on a file that came from the internet).
const START = MAC ? 'Run' : 'Double-click';
// On a Mac the suggestion is a folder in the home folder: Documents there is often kept in iCloud, and every
// app that reads it is first stopped by a question from the Mac itself.
const notesDefault = () => MAC ? path.join(profile(), 'Continuum') : path.join(profile(), 'Documents', 'Continuum');
// A folder the person typed, pasted or dragged in. Outside Windows, ~ and backslash-space are read as Terminal means them.
const typed = text => process.platform === 'win32' ? unquote(text) : require('./guided-mac').typed(text);
// The package that should do the work: the permanent copy once it exists, else this folder.
const installedRoot = () => fs.existsSync(path.join(permanent(), 'scripts', 'setup.js')) ? permanent() : SOURCE;

function log(text) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(logFile(), new Date().toISOString() + ' ' + String(text).replace(/\r?\n/g, '\n    ') + '\n', 'utf8');
  } catch (_) { /* The log is a help, never a reason to fail. */ }
}
// Answers come from the keyboard, or line by line from a pipe (tests). An empty line takes the default.
function reader() {
  const queue = [];
  const waiting = [];
  let ended = false;
  const tty = Boolean(process.stdin.isTTY);
  const rl = require('readline').createInterface({ input: process.stdin, terminal: false });
  rl.on('line', line => { if (waiting.length) waiting.shift()(line); else queue.push(line); });
  rl.on('close', () => { ended = true; while (waiting.length) waiting.shift()(null); });
  async function ask(question, fallback) {
    process.stdout.write('\n' + question + (fallback ? ' [' + fallback + ']' : '') + ' ');
    let line = queue.length ? queue.shift() : ended ? null : await new Promise(resolve => waiting.push(resolve));
    if (line === null) { process.stdout.write('\n'); throw Object.assign(new Error('no more answers'), { plain: 'The window was closed before all questions were answered' }); }
    line = line.trim();
    if (!tty) process.stdout.write(line + '\n');
    return line || fallback || '';
  }
  return { ask, close: () => rl.close() };
}
const yes = (answer, byDefault) => answer === '' ? byDefault : /^y(es)?$/i.test(answer.trim());
const unquote = text => String(text).trim().replace(/^["']+|["']+$/g, '').trim();
// What is in a chosen notes folder: 'new' (missing or empty), 'vault' (has START HERE.md) or 'foreign'.
function folderKind(dir) {
  if (!fs.existsSync(dir)) return 'new';
  if (!fs.statSync(dir).isDirectory()) return 'foreign';
  if (fs.existsSync(path.join(dir, 'START HERE.md'))) return 'vault';
  return fs.readdirSync(dir).length ? 'foreign' : 'new';
}
// Best effort: true when the folder is on a network share or a drive Windows does not call a fixed disk.
// null when it cannot tell (not Windows, the check failed): then nothing is said.
function remote(dir) {
  if (/^\\\\/.test(dir)) return true;
  if (process.platform !== 'win32' || !/^[a-z]:/i.test(dir)) return null;
  try {
    const r = spawnSync('fsutil', ['fsinfo', 'drivetype', dir.slice(0, 2)], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (r.status !== 0 || !/Drive/i.test(r.stdout)) return null;
    return !/Fixed Drive/i.test(r.stdout);
  } catch (_) { return null; }
}
function machineDefault() {
  return (os.hostname().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 63 - label().length) || 'pc') + '-' + label().toLowerCase();
}
function validZone(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return Boolean(zone); } catch (_) { return false; }
}
// Everything setup needs at run time; never .git, tests or build notes.
const KEEP = ['scripts', 'hooks', 'skills', 'vault-skeleton', 'hermes', '.claude-plugin', '.codex-plugin', 'plugin.json',
  'README.md', 'INSTALL-CLAUDE.md', 'INSTALL-CODEX.md', 'INSTALL-HERMES.md', 'INSTALL-ANTIGRAVITY.md', 'LICENSE'];
// What makes the folder an Antigravity plugin. Only the Antigravity program folder gets these, so no other
// app finds a hooks.json at the top of its own copy.
const KEEP_ANTIGRAVITY = ['.antigravity-plugin', 'hooks.json', 'rules'];
// A folder is Continuum's own program copy when it holds Continuum's setup script and a manifest named continuum.
function ours(dir) {
  if (!fs.existsSync(path.join(dir, 'scripts', 'setup.js'))) return false;
  return ['plugin.json', path.join('.antigravity-plugin', 'plugin.json'), path.join('.claude-plugin', 'plugin.json')].some(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).name === 'continuum'; } catch (_) { return false; }
  });
}
// A notes folder may not sit inside the program folder or the settings folder, nor hold the program folder:
// Remove for Antigravity takes the program folder out, and notes inside it would go with it.
function inProgram(vault) {
  const C = require('./config');
  return C.covers(permanent(), vault) || C.covers(settingsFolder(), vault) || C.covers(vault, permanent());
}
function copyPackage() {
  if (same(SOURCE, permanent())) return false;
  // A folder that already holds something else is never filled with Continuum's files (and so never removed later).
  if (fs.existsSync(permanent()) && (!fs.statSync(permanent()).isDirectory() || (fs.readdirSync(permanent()).length && !ours(permanent())))) {
    throw Object.assign(new Error('foreign program folder: ' + permanent()),
      { plain: 'The folder ' + permanent() + ' already holds other files, so the Continuum program was not copied there' });
  }
  fs.mkdirSync(permanent(), { recursive: true });
  const keep = isAntigravity() ? KEEP.concat(KEEP_ANTIGRAVITY) : KEEP;
  const names = fs.readdirSync(SOURCE).filter(n => keep.includes(n) || /\.(?:cmd|command)$/i.test(n) || /guide/i.test(n));
  for (const name of names) fs.cpSync(path.join(SOURCE, name), path.join(permanent(), name), { recursive: true, force: true });
  return true;
}
// Antigravity only: takes the program folder out of Antigravity's plugins folder, which is what stops Antigravity
// running Continuum. Only a folder named continuum, inside a folder named plugins, that holds Continuum's own
// plugin manifest is removed. True when a folder was removed, false when there was none.
function removeProgram(checkOnly) {
  const dir = permanent();
  if (!isAntigravity() || !fs.existsSync(dir)) return false;
  let name = '';
  try { name = JSON.parse(fs.readFileSync(path.join(dir, '.antigravity-plugin', 'plugin.json'), 'utf8')).name; } catch (_) { /* judged below */ }
  if (name !== 'continuum' || !ours(dir) || path.basename(dir).toLowerCase() !== 'continuum' || path.basename(path.dirname(dir)).toLowerCase() !== 'plugins') {
    throw Object.assign(new Error('not a Continuum program folder: ' + dir), { plain: 'The folder ' + dir + ' does not look like Continuum\'s program folder, so it was left alone' });
  }
  // Notes or settings inside the program folder would be removed with it. Setup refuses such a notes folder; a
  // settings file changed by hand, or one that cannot be read, is not trusted here.
  // Three checks, and removal goes ahead only when all three say the notes are somewhere else: the settings file
  // Continuum really uses (CONTINUUM_CONFIG included) must be readable when it exists, its notes folder must not
  // be inside the program folder, and nothing in the program folder may look like a notes folder.
  const C = require('./config');
  const file = C.configPath();
  let vault = null;
  if (fs.existsSync(file)) {
    try { vault = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).vault; } catch (_) { vault = undefined; }
    if (typeof vault !== 'string' || !vault) {
      throw Object.assign(new Error('settings unreadable: ' + file), { plain: 'Continuum\'s settings file ' + file + ' cannot be read, so Continuum cannot tell where your notes are. ' +
        'Nothing was removed. If your notes are not inside ' + dir + ', you can delete that folder yourself' });
    }
  }
  const notesInside = (d, depth) => fs.readdirSync(d, { withFileTypes: true }).some(e => e.isDirectory()
    ? !(depth === 0 && e.name === 'vault-skeleton') && notesInside(path.join(d, e.name), depth + 1)
    : e.name.toLowerCase() === 'start here.md');
  if ((vault && C.covers(dir, vault)) || C.covers(dir, path.dirname(file)) || C.covers(dir, settingsFolder()) || notesInside(dir, 0)) {
    throw Object.assign(new Error('notes or settings inside ' + dir), { plain: 'Your notes folder or Continuum\'s settings are inside the program folder ' + dir +
      ', so nothing was removed. Move your notes folder to another place first, run setup again with the new address, then run Remove' });
  }
  if (checkOnly) return true;
  fs.rmSync(dir, { recursive: true, force: true });
  if (fs.existsSync(dir)) throw Object.assign(new Error('still there: ' + dir), { plain: 'The folder ' + dir + ' could not be removed. Close Antigravity and try again' });
  return true;
}
// The guide to point at, for this host only (its name holds Claude, Codex or Antigravity): the HTML copy first
// (it opens in the browser with a double-click), else any other guide for this host.
function guideFile(root) {
  const mark = new RegExp(label(), 'i');
  const names = fs.readdirSync(root).filter(n => /guide/i.test(n) && !/\.(?:cmd|command)$/i.test(n) && mark.test(n) && /\bmac\b/i.test(n) === MAC);
  const found = names.find(n => /\.html$/i.test(n)) || names[0];
  return path.join(root, found || 'INSTALL-' + label().toUpperCase() + '.md');
}
// Best effort, Windows only: "Continuum Notes.lnk" on the Desktop, opening the notes folder. Windows names the
// Desktop (it may be redirected into OneDrive); CONTINUUM_DESKTOP overrides it so tests never touch the real one.
// Paths go to PowerShell as environment variables, so spaces and apostrophes need no quoting. True when created.
const SHORTCUT = 'Continuum Notes';
function shortcut(vault) {
  if (MAC) return require('./guided-mac').shortcut(vault, SHORTCUT, log); // a link, not a .lnk file
  if (process.platform !== 'win32') return false;
  const script = "$ErrorActionPreference='Stop'; $d=$env:CONTINUUM_LNK_DESKTOP; if(-not $d){$d=[Environment]::GetFolderPath('Desktop')}; " +
    "if(-not $d){throw 'no Desktop folder'}; New-Item -ItemType Directory -Force -Path $d | Out-Null; " +
    "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d ($env:CONTINUUM_LNK_NAME + '.lnk'))); " +
    "$s.TargetPath=$env:CONTINUUM_LNK_TARGET; $s.WorkingDirectory=$env:CONTINUUM_LNK_TARGET; $s.Save(); Write-Output (Join-Path $d ($env:CONTINUUM_LNK_NAME + '.lnk'))";
  try {
    const env = { ...process.env, CONTINUUM_LNK_DESKTOP: process.env.CONTINUUM_DESKTOP || '', CONTINUUM_LNK_NAME: SHORTCUT, CONTINUUM_LNK_TARGET: vault };
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 15000, windowsHide: true, env });
    const made = (r.stdout || '').trim();
    const ok = !r.error && r.status === 0 && Boolean(made) && fs.existsSync(made);
    log('shortcut ' + (ok ? 'created: ' + made : 'not created: exit ' + r.status + ' ' + (r.error ? r.error.message : '') + (r.stderr || '')));
    return ok;
  } catch (e) { log('shortcut not created: ' + e.message); return false; }
}
function node(root, script, args) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), '--host', host.name(), ...args],
    { encoding: 'utf8', timeout: 60000, windowsHide: true, env: process.env });
  log('ran ' + script + ' ' + args.filter(a => a !== '--person').join(' ') + ' -> exit ' + r.status + '\n' + (r.stdout || '') + (r.stderr || ''));
  return { ok: !r.error && r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
// status.js lines -> what is missing, each with the one thing to do about it.
function verdict(statusOut) {
  const todo = [];
  const again = START + ' "Continuum Setup for ' + label() + '" again';
  for (const line of String(statusOut).split(/\r?\n/)) {
    if (/^FAIL node version/.test(line)) todo.push('Node.js is too old. Install the version marked LTS from nodejs.org, then run setup again.');
    else if (/^FAIL config/.test(line)) todo.push('Continuum\'s settings are missing. ' + again + '.');
    else if (/^FAIL vault folder/.test(line)) todo.push('Your notes folder or its START HERE.md file is missing. ' + again + ' and pick your notes folder.');
    else if (/^FAIL claude settings/.test(line)) todo.push('Claude\'s own settings file could not be read, so Continuum could not check its hook lines there. ' +
      'Send the file guided-setup.log from ' + settingsFolder() + ' to whoever gave you Continuum.');
    else if (/^FAIL claude hooks/.test(line)) todo.push('Claude\'s settings file is missing Continuum\'s hook lines, or they point at a program folder that moved. ' + again + '.');
    else if (/^FAIL (plugin manifest|Antigravity hooks: none found)/.test(line)) todo.push('Continuum\'s program folder is missing from Antigravity\'s plugins folder, or it is incomplete. ' + again + '.');
    else if (isAntigravity() && /^FAIL hooks file .* cannot be read/.test(line) && line.includes(require('./antigravity-setup').globalFile())) {
      todo.push('Antigravity\'s own hooks file cannot be read: ' + require('./antigravity-setup').globalFile() + '. Continuum\'s setup file does not write to that file, ' +
        'so running setup again will not repair it. Repair that file or put back a copy of it; the hook groups in it belong to Antigravity and to other programs.');
    } else if (/^FAIL hooks file/.test(line) && isAntigravity()) todo.push('The hooks file in Continuum\'s program folder is missing, damaged or turned off. ' + again + '.');
    else if (/^INFO Continuum hooks are both in the plugin and in/.test(line)) todo.push('Continuum is in Antigravity twice, as a plugin and in Antigravity\'s own hooks file, so everything would run twice. ' +
      START + ' "Continuum Remove for Antigravity", then "Continuum Setup for Antigravity".');
    else if (/^FAIL hooks file/.test(line)) todo.push('The Codex hooks file is missing or points at a program folder that moved. ' + START + ' "Continuum Setup for Codex" again.');
    else if (/^(FAIL|INFO) hooks trusted in Codex: (no|cannot tell)/.test(line)) {
      todo.push((/cannot tell/.test(line) ? 'Could not see whether Codex trusts the hooks. If you have not done it yet: ' : 'Codex does not trust the hooks yet: ') +
        (MAC ? 'hold Command and press the comma key' : 'press Ctrl and the comma key') + ', type hooks, click Hooks, click your notes folder, click Trust all.');
    }
  }
  return todo;
}
module.exports = { STEPS, steps, CLAUDE_STEPS, claudeSteps, ANTIGRAVITY_STEPS, antigravitySteps, stepsFor, label, settingsFolder, isClaude, isAntigravity, removeProgram, inProgram, SOURCE, permanent, logFile, installedRoot, log, reader, yes, unquote, folderKind, remote,
  machineDefault, validZone, copyPackage, guideFile, SHORTCUT, shortcut, node, verdict, same, notesDefault, typed, MAC };
