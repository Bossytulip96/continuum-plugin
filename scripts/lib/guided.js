'use strict';
// Helpers for the double-click Codex setup (scripts/guided-setup.js): the one copy of the five
// steps left after setup, the answer reader, folder and drive checks, the package copy, and the
// plain-word reading of status.js. Nothing here prints a stack trace.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
  'Hold Ctrl and press the comma key to open Settings. Type hooks in the search box and click Hooks. Click the row with your notes folder (it says 6 need review), then click Trust all.',
  'Go back to the chat screen. Above the message box you should see the name of your notes folder and the words This computer. In a small window you may see two small pictures there instead of the words: a folder and a laptop. If it does not say This computer, click it and pick This computer.',
  'Type this and send it: What are my standing rules? If the answer lists rules from your notes, Continuum is working.'
];
const STEPS = steps();
const SOURCE = path.resolve(__dirname, '..', '..');
const profile = () => process.env.USERPROFILE || os.homedir();
const permanent = () => path.join(profile(), '.codex', 'plugins', 'continuum');
const logFile = () => path.join(profile(), '.continuum', 'codex', 'guided-setup.log');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
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
  return (os.hostname().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 58) || 'pc') + '-codex';
}
function validZone(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return Boolean(zone); } catch (_) { return false; }
}
// Everything setup needs at run time; never .git, tests or build notes.
const KEEP = ['scripts', 'hooks', 'skills', 'vault-skeleton', 'hermes', '.claude-plugin', '.codex-plugin', 'plugin.json',
  'README.md', 'INSTALL-CLAUDE.md', 'INSTALL-CODEX.md', 'INSTALL-HERMES.md', 'LICENSE'];
function copyPackage() {
  if (same(SOURCE, permanent())) return false;
  fs.mkdirSync(permanent(), { recursive: true });
  const names = fs.readdirSync(SOURCE).filter(n => KEEP.includes(n) || /\.cmd$/i.test(n) || /guide/i.test(n));
  for (const name of names) fs.cpSync(path.join(SOURCE, name), path.join(permanent(), name), { recursive: true, force: true });
  return true;
}
// The guide to point at: the HTML copy first (it opens in the browser with a double-click), else any other guide.
function guideFile(root) {
  const names = fs.readdirSync(root).filter(n => /guide/i.test(n) && !/\.cmd$/i.test(n));
  const found = names.find(n => /\.html$/i.test(n)) || names[0];
  return path.join(root, found || 'INSTALL-CODEX.md');
}
// Best effort, Windows only: "Continuum Notes.lnk" on the Desktop, opening the notes folder. Windows names the
// Desktop (it may be redirected into OneDrive); CONTINUUM_DESKTOP overrides it so tests never touch the real one.
// Paths go to PowerShell as environment variables, so spaces and apostrophes need no quoting. True when created.
const SHORTCUT = 'Continuum Notes';
function shortcut(vault) {
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
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), '--host', 'codex', ...args],
    { encoding: 'utf8', timeout: 60000, windowsHide: true, env: process.env });
  log('ran ' + script + ' ' + args.filter(a => a !== '--person').join(' ') + ' -> exit ' + r.status + '\n' + (r.stdout || '') + (r.stderr || ''));
  return { ok: !r.error && r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}
// status.js lines -> what is missing, each with the one thing to do about it.
function verdict(statusOut) {
  const todo = [];
  for (const line of String(statusOut).split(/\r?\n/)) {
    if (/^FAIL node version/.test(line)) todo.push('Node.js is too old. Install the version marked LTS from nodejs.org, then run setup again.');
    else if (/^FAIL config/.test(line)) todo.push('Continuum\'s settings are missing. Double-click "Continuum Setup for Codex" again.');
    else if (/^FAIL vault folder/.test(line)) todo.push('Your notes folder or its START HERE.md file is missing. Double-click "Continuum Setup for Codex" again and pick your notes folder.');
    else if (/^FAIL hooks file/.test(line)) todo.push('The Codex hooks file is missing or points at a program folder that moved. Double-click "Continuum Setup for Codex" again.');
    else if (/^(FAIL|INFO) hooks trusted in Codex: (no|cannot tell)/.test(line)) {
      todo.push((/cannot tell/.test(line) ? 'Could not see whether Codex trusts the hooks. If you have not done it yet: ' : 'Codex does not trust the hooks yet: ') +
        'press Ctrl and the comma key, type hooks, click Hooks, click your notes folder, click Trust all.');
    }
  }
  return todo;
}
module.exports = { STEPS, steps, SOURCE, permanent, logFile, installedRoot, log, reader, yes, unquote, folderKind, remote,
  machineDefault, validZone, copyPackage, guideFile, SHORTCUT, shortcut, node, verdict, same };
