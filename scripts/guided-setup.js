'use strict';
// Double-click setup on Windows for Codex ("Continuum Setup for Codex.cmd", --host codex), for the Claude
// desktop app ("Continuum Setup for Claude.cmd", --host claude) and for Google Antigravity
// ("Continuum Setup for Antigravity.cmd", --host antigravity): plain questions, one at
// a time, each with a default taken by pressing Enter. --check and --remove back the other two .cmd
// files. Any failure is one plain sentence plus the path of a log file; never a stack trace.
const fs = require('fs');
const path = require('path');
const G = require('./lib/guided');

const say = (...lines) => lines.forEach(l => process.stdout.write(l + '\n'));
class Plain extends Error {}
const fail = (plain, detail) => { throw Object.assign(new Plain(plain), { detail }); };

async function setupFlow(ask) {
  const claude = G.isClaude();
  const antigravity = G.isAntigravity();
  if (antigravity) {
    say('This sets up Continuum, a notes memory for Google Antigravity. You answer a few questions; press Enter to take the suggestion in [brackets].',
      'Nothing is changed outside three places: the Continuum program folder (it goes into Antigravity\'s own plugins folder), its settings folder, and the notes folder you choose.',
      'It also puts one shortcut on your Desktop, named Continuum Notes, that opens your notes folder.');
  } else if (claude) {
    say('This sets up Continuum, a notes memory for the Claude app (its Code tab). You answer a few questions; press Enter to take the suggestion in [brackets].',
      'It changes these places only: the Continuum program folder, its settings folder, and the notes folder you choose.',
      'It also puts one shortcut on your Desktop, named Continuum Notes, that opens your notes folder.',
      'And it changes Claude\'s own settings file: it adds Continuum\'s hook lines, and adds your notes folder to the folders Claude may read. A copy of that file as it was is kept.');
  } else {
    say('This sets up Continuum, a notes memory for Codex in the ChatGPT app. You answer a few questions; press Enter to take the suggestion in [brackets].',
      'Nothing is changed outside three places: the Continuum program folder, its settings folder, and the notes folder you choose.',
      'It also puts one shortcut on your Desktop, named Continuum Notes, that opens your notes folder.');
  }
  let name = '';
  while (!name) name = (await ask('What is your name?')).replace(/\s+/g, ' ');
  let vault = '';
  while (!vault) {
    const answer = path.resolve(G.typed(await ask('Where should your notes folder live?', G.notesDefault())));
    if (G.inProgram(answer)) { say('That folder belongs to Continuum\'s own program or settings. Please pick a different folder for your notes.'); continue; }
    const kind = G.folderKind(answer);
    if (kind === 'foreign') { say('That folder already holds other files. Please pick a different folder (a new or empty one).'); continue; }
    if (kind === 'vault') say('That looks like an existing Continuum notes folder. It will be kept as it is.');
    // The warning is what Codex itself shows; nothing is known about the Claude app or Antigravity here, so it says nothing.
    if (!claude && !antigravity && G.remote(answer) === true) {
      say('Codex shows a "may not work safely here" warning for cloud or network drives.');
      if (!G.yes(await ask('Use it anyway? (y/N)'), false)) continue;
    }
    vault = answer;
  }
  let machine = '';
  while (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(machine)) {
    machine = (await ask('What should this computer be called in your notes?', G.machineDefault())).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(machine)) say('Please use letters and numbers only (a dash is fine), up to 64 characters.');
  }
  let zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  say('Your time zone looks like ' + zone + '.');
  if (!G.yes(await ask('Is that right? (Y/n)'), true)) {
    zone = '';
    while (!G.validZone(zone)) {
      zone = await ask('Type your time zone, for example America/New_York:');
      if (!G.validZone(zone)) say('That is not a time zone this computer knows. Try a form like America/Chicago or Europe/London.');
    }
  }
  say('', 'Here is what will be set up:', '  Name: ' + name, '  Notes folder: ' + vault, '  This computer: ' + machine, '  Time zone: ' + zone,
    '  Desktop shortcut: ' + G.SHORTCUT);
  if (!G.yes(await ask('Go ahead? (Y/n)'), true)) { say('Nothing was changed.'); return; }

  const root = G.permanent();
  say('');
  if (G.copyPackage()) say('Copying the Continuum program to ' + root + ' ...');
  else say('The Continuum program is already in ' + root + '.');
  say(claude ? 'Creating your settings and notes folder, and adding Continuum\'s hook lines to Claude\'s settings file ...'
    : antigravity ? 'Creating your settings and notes folder ...' : 'Creating your settings, notes folder and Codex hooks ...');
  const setup = G.node(root, 'setup.js', ['--person', name, '--vault', vault, '--machine', machine, '--timezone', zone,
    '--autonomy', 'ask', ...(claude ? ['--allow-folder', 'yes', '--hooks', 'user']
      : ['--allow-folder', 'no', '--hooks', antigravity ? 'plugin' : 'project'])]);
  // Claude's settings file that cannot be read is left alone by setup.js; here that is a failure, said plainly.
  if (claude && /could not be read as (Claude Code )?settings/.test(setup.out)) {
    fail('Claude\'s settings file could not be read, so it was left alone and Continuum\'s hook lines were not added', setup.out);
  }
  if (!setup.ok) fail(claude ? 'Setting up the notes folder and Claude\'s hook lines did not work'
    : antigravity ? 'Setting up the settings and the notes folder did not work' : 'Setting up the notes folder and the Codex hooks did not work', setup.out);
  say('Checking the result ...');
  const todo = G.verdict(G.node(root, 'status.js', claude ? ['--guided'] : []).out).filter(t => !/trust/i.test(t));
  if (todo.length) fail('The check after setup found a problem: ' + todo[0], todo.join('\n'));
  const settings = G.settingsFolder();
  const linked = G.shortcut(vault);
  // The first copy that exists is the oldest one: Claude's settings file before this setup changed it.
  const copy = [...setup.out.matchAll(/kept at (.+?)\.?\s*$/gm)].map(m => m[1]).find(f => fs.existsSync(f));
  const steps = G.stepsFor(vault, linked);
  say('', 'Done. Continuum is set up:', '  Program folder: ' + root, '  Settings folder: ' + settings, '  Notes folder: ' + vault,
    ...(linked ? ['  Desktop shortcut: ' + G.SHORTCUT + ' (opens your notes folder)'] : []),
    ...(claude ? ['  Claude\'s settings file: ' + (setup.out.match(/^Claude hooks (?:written|unchanged): (.+?)(?: \(|$)/m) || [])[1],
      ...(copy ? ['  Copy of it as it was: ' + copy] : [])] : []),
    '', steps.length + ' steps are left, in ' + (claude ? 'the Claude app' : antigravity ? 'Antigravity' : 'the ChatGPT app') + ':',...steps.map((s, i) => '  ' + (i + 1) + '. ' + s),
    '', 'The guide is here: ' + G.guideFile(root));
}
async function checkFlow() {
  const root = G.installedRoot();
  const result = G.node(root, 'status.js', G.isClaude() ? ['--guided'] : []);
  const todo = G.verdict(result.out);
  if (!todo.length && result.ok) { say('Everything is in place.'); return; }
  if (!todo.length) fail('The check could not finish', result.out);
  say('Not everything is in place yet:', ...todo.map(t => '  - ' + t));
}
async function removeFlow(ask) {
  if (G.isClaude()) return removeClaude(ask);
  if (G.isAntigravity()) return removeAntigravity(ask);
  say('This removes only Continuum\'s entries from the Codex hooks file, so Codex stops running Continuum.',
    'Your notes folder and Continuum\'s settings stay exactly as they are.');
  if (!/^yes$/i.test(await ask('Type YES to remove, or just press Enter to stop:'))) { say('Nothing was changed.'); return; }
  const result = G.node(G.installedRoot(), 'setup.js', ['--remove']);
  if (!result.ok) fail('Removing Continuum\'s hooks did not work', result.out);
  say(/Removed/.test(result.out) ? 'Done. Codex will no longer run Continuum. Your notes and settings are still there.'
    : 'There were no Continuum hooks to remove. Nothing was changed.');
}
async function removeClaude(ask) {
  say('This removes only Continuum\'s hook lines from Claude\'s settings file, so the Claude app stops running Continuum.',
    'Everything else in that file stays as it is, and a copy of the file is kept first.',
    'Your notes folder and Continuum\'s settings stay exactly as they are.');
  if (!/^yes$/i.test(await ask('Type YES to remove, or just press Enter to stop:'))) { say('Nothing was changed.'); return; }
  const result = G.node(G.installedRoot(), 'setup.js', ['--remove']);
  if (!result.ok) fail('Removing Continuum\'s hook lines from Claude\'s settings file did not work', result.out);
  say(/^Removed/m.test(result.out) ? 'Done. The Claude app will no longer run Continuum. Your notes and settings are still there.'
    : 'There were no Continuum hook lines to remove. Nothing was changed.');
}
// Antigravity runs Continuum because the program folder sits in its plugins folder, so removing means taking
// that folder out. A Continuum group in Antigravity's own hooks file (the other way in INSTALL-ANTIGRAVITY.md)
// is taken out too. This window's own folder cannot be removed while it is open, so that case is said plainly.
async function removeAntigravity(ask) {
  const dir = G.permanent();
  say('This removes Continuum\'s program folder from Antigravity\'s plugins folder, so Antigravity stops running Continuum.',
    'The program folder is ' + dir,
    'Your notes folder and Continuum\'s settings stay exactly as they are.');
  if (G.same(G.SOURCE, dir)) fail('This file was opened from the program folder itself, which cannot remove itself. ' +
    'Open "Continuum Remove for Antigravity" from the Continuum folder you unzipped instead');
  if (!/^yes$/i.test(await ask('Type YES to remove, or just press Enter to stop:'))) { say('Nothing was changed.'); return; }
  // The safety checks first, so a refusal leaves everything as it was, the global hooks file included.
  G.removeProgram(true);
  const result = G.node(G.installedRoot(), 'setup.js', ['--remove']);
  if (!result.ok) fail('Removing Continuum from Antigravity did not work', result.out);
  const removed = G.removeProgram();
  say(removed || /^Removed/m.test(result.out)
    ? 'Done. Antigravity will no longer run Continuum. Your notes and settings are still there. If Antigravity is open, close it and open it again.'
    : 'Continuum was not in Antigravity. Nothing was changed.');
}
async function main() {
  const args = process.argv.slice(2);
  const input = G.reader();
  try {
    if (args.includes('--check')) await checkFlow();
    else if (args.includes('--remove')) await removeFlow(input.ask);
    else await setupFlow(input.ask);
  } catch (e) {
    G.log('failure: ' + (e.plain || e.message) + '\n' + (e.detail || '') + '\n' + (e.stack || ''));
    say('', 'Something did not work: ' + (e instanceof Plain ? e.message : e.plain || 'an unexpected error') + '.',
      'Nothing else was changed after that point. The technical details are in ' + G.logFile());
    process.exitCode = 1;
  } finally { input.close(); }
}
if (require.main === module) main();
