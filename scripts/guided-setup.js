'use strict';
// Double-click setup for Codex on Windows ("Continuum Setup for Codex.cmd"): plain questions, one at
// a time, each with a default taken by pressing Enter. --check and --remove back the other two .cmd
// files. Any failure is one plain sentence plus the path of a log file; never a stack trace.
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('./lib/guided');

const say = (...lines) => lines.forEach(l => process.stdout.write(l + '\n'));
class Plain extends Error {}
const fail = (plain, detail) => { throw Object.assign(new Plain(plain), { detail }); };

async function setupFlow(ask) {
  say('This sets up Continuum, a notes memory for Codex in the ChatGPT app. You answer a few questions; press Enter to take the suggestion in [brackets].',
    'Nothing is changed outside three places: the Continuum program folder, its settings folder, and the notes folder you choose.',
    'It also puts one shortcut on your Desktop, named Continuum Notes, that opens your notes folder.');
  let name = '';
  while (!name) name = (await ask('What is your name?')).replace(/\s+/g, ' ');
  const profile = process.env.USERPROFILE || os.homedir();
  let vault = '';
  while (!vault) {
    const answer = path.resolve(G.unquote(await ask('Where should your notes folder live?', path.join(profile, 'Documents', 'Continuum'))));
    const kind = G.folderKind(answer);
    if (kind === 'foreign') { say('That folder already holds other files. Please pick a different folder (a new or empty one).'); continue; }
    if (kind === 'vault') say('That looks like an existing Continuum notes folder. It will be kept as it is.');
    if (G.remote(answer) === true) {
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
  say('Creating your settings, notes folder and Codex hooks ...');
  const setup = G.node(root, 'setup.js', ['--person', name, '--vault', vault, '--machine', machine, '--timezone', zone,
    '--autonomy', 'ask', '--allow-folder', 'no', '--hooks', 'project']);
  if (!setup.ok) fail('Setting up the notes folder and the Codex hooks did not work', setup.out);
  say('Checking the result ...');
  const todo = G.verdict(G.node(root, 'status.js', []).out).filter(t => !/trust/i.test(t));
  if (todo.length) fail('The check after setup found a problem: ' + todo[0], todo.join('\n'));
  const settings = path.join(profile, '.continuum', 'codex');
  const linked = G.shortcut(vault);
  say('', 'Done. Continuum is set up:', '  Program folder: ' + root, '  Settings folder: ' + settings, '  Notes folder: ' + vault,
    ...(linked ? ['  Desktop shortcut: ' + G.SHORTCUT + ' (opens your notes folder)'] : []),
    '', G.STEPS.length + ' steps are left, in the ChatGPT app:', ...G.steps(vault, linked).map((s, i) => '  ' + (i + 1) + '. ' + s),
    '', 'The guide is here: ' + G.guideFile(root));
}
async function checkFlow() {
  const root = G.installedRoot();
  const result = G.node(root, 'status.js', []);
  const todo = G.verdict(result.out);
  if (!todo.length && result.ok) { say('Everything is in place.'); return; }
  if (!todo.length) fail('The check could not finish', result.out);
  say('Not everything is in place yet:', ...todo.map(t => '  - ' + t));
}
async function removeFlow(ask) {
  say('This removes only Continuum\'s entries from the Codex hooks file, so Codex stops running Continuum.',
    'Your notes folder and Continuum\'s settings stay exactly as they are.');
  if (!/^yes$/i.test(await ask('Type YES to remove, or just press Enter to stop:'))) { say('Nothing was changed.'); return; }
  const result = G.node(G.installedRoot(), 'setup.js', ['--remove']);
  if (!result.ok) fail('Removing Continuum\'s hooks did not work', result.out);
  say(/Removed/.test(result.out) ? 'Done. Codex will no longer run Continuum. Your notes and settings are still there.'
    : 'There were no Continuum hooks to remove. Nothing was changed.');
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
