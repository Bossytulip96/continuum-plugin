'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const C = require('./lib/config');

// A yes to the sixth question: add the vault to the folders Claude Code reads without
// asking (permissions.additionalDirectories in its user settings). Nothing else changes.
function allowFolder(c) {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.USERPROFILE || os.homedir(), '.claude');
  const file = path.join(path.resolve(C.normalize(dir)), 'settings.json');
  const plain = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const key = v => { const p = path.resolve(C.normalize(v)); return process.platform === 'win32' ? p.toLowerCase() : p; };
  let data = null;
  try { data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim() || '{}') : {}; } catch (_) { /* left alone below */ }
  const list = plain(data) && (data.permissions === undefined || plain(data.permissions))
    ? (data.permissions || {}).additionalDirectories ?? [] : null;
  if (!Array.isArray(list)) return 'Not added: ' + file + ' could not be read as Claude Code settings, so it was left alone.';
  if (list.some(v => typeof v === 'string' && key(v) === key(c.vault))) return 'Claude Code already allows the vault folder (' + file + ').';
  if (fs.existsSync(file)) fs.copyFileSync(file, C.configFile(c, 'claude-settings-before.json'));
  data.permissions = { ...(data.permissions || {}), additionalDirectories: [...list, c.vault] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  // wx: never write through a file or link that is already sitting at the temporary name.
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tmp, file);
  return 'Added the vault to Claude Code\'s allowed folders (' + file + '). The file as it was is kept at ' +
    C.configFile(c, 'claude-settings-before.json') + '.';
}
function setup(args) {
  const answers = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--(person|vault|machine|timezone|autonomy|allow-folder)$/.test(args[i]) || args[i + 1] === undefined) {
      throw new Error('Use --person --vault --machine --timezone --autonomy --allow-folder with one value each');
    }
    if (answers[args[i].slice(2)] !== undefined) throw new Error('Duplicate setup argument');
    answers[args[i].slice(2)] = args[i + 1];
  }
  for (const name of ['person', 'vault', 'machine', 'timezone', 'autonomy']) {
    if (!answers[name]) throw new Error('Missing --' + name);
  }
  const allow = String(answers['allow-folder'] || '').toLowerCase();
  delete answers['allow-folder'];
  if (allow !== 'yes' && allow !== 'no') {
    throw new Error('Missing --allow-folder: ask the sixth setup question, then pass yes or no');
  }
  const file = C.configPath();
  let previous = {};
  if (fs.existsSync(file)) previous = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const c = C.validate({ version: 1, gates: { 'vendor-write': true, 'email-send': true,
    'vault-delete': true, 'system-change': true, money: 'never' },
    inject: { startPage: 'START HERE.md', maxNoteChars: 25000, maxNotesPerPrompt: 3 },
    digests: true, quietHours: null, ...previous, ...answers }, file);
  fs.mkdirSync(c.vault, { recursive: true });
  const empty = fs.readdirSync(c.vault).length === 0;
  const created = [];
  if (empty) {
    const replacements = { person: c.person, machine: c.machine, date: C.date(c) };
    function copy(dir, rel = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Skeleton links are not supported');
        const next = path.join(rel, entry.name);
        const from = C.pluginPath('vault-skeleton', next);
        const to = C.vaultPath(c, next);
        if (entry.isDirectory()) { fs.mkdirSync(to, { recursive: true }); copy(from, next); }
        else if (entry.isFile()) {
          const body = fs.readFileSync(from, 'utf8').replace(/\{\{(person|machine|date)\}\}/g,
            (_, name) => replacements[name]);
          fs.writeFileSync(to, body, { encoding: 'utf8', flag: 'wx' });
          created.push(next);
        }
      }
    }
    copy(C.pluginPath('vault-skeleton'));
  }
  const { configPath, configDir, ...saved } = c;
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(C.configFile(c, path.basename(file)), JSON.stringify(saved, null, 2) + '\n', 'utf8');
  console.log('Config saved: ' + file);
  console.log('Vault: ' + c.vault);
  console.log(created.length ? 'Created ' + created.length + ' template files.' :
    'Existing vault preserved; no template files written.');
  let folder = 'Claude Code asks before reading folders outside the one it started in. ' +
    'Start Claude inside the vault, or use --add-dir, to read it without that question.';
  // The allowed-folder answer is about Claude Code's settings, so a Codex setup leaves them alone.
  if (C.host.name() !== 'claude') return c;
  if (allow === 'yes') {
    try { folder = allowFolder(c); } catch (e) { folder = 'Not added: ' + e.message + '. ' + folder; }
  }
  console.log(folder);
  return c;
}
// Codex (--host codex) also writes the hooks file and AGENTS.md, and accepts --hooks and --remove.
// Hermes (--host hermes) also installs the adapter into --hermes-home and accepts --node, --digests, --remove.
if (require.main === module) C.runCli(() => C.host.isCodex()
  ? require('./lib/codex-setup').run(process.argv.slice(2), setup)
  : C.host.isHermes() ? require('./lib/hermes-setup').run(process.argv.slice(2), setup) : setup(process.argv.slice(2)));
module.exports = { setup };
