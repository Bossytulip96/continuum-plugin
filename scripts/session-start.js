'use strict';
const fs = require('fs');
const C = require('./lib/config');
const V = require('./lib/vault');
const { LEVELS } = require('./approve');
const X = require('./lib/codex');

function start(input, c) {
  const onCodex = C.host.isCodex();
  // The Codex desktop app starts side sessions at the same moment, so on Codex a failed
  // index rebuild (another firing writing the same file) must not cost the context.
  if (C.host.fromInputs()) { try { V.buildIndex(c); } catch (e) { C.logError(e); } } else V.buildIndex(c);
  const page = fs.readFileSync(C.vaultPath(c, c.inject.startPage), 'utf8').slice(0, c.inject.maxNoteChars);
  let agreements = null;
  try { agreements = fs.readFileSync(C.vaultPath(c, 'Knowledge', 'Working Agreements.md'), 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const section = agreements && agreements.match(/^## Standing rules\s*\r?\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  let rules = section ? section[1].split(/\r?\n/).filter(line => /^[1-9]\.\s/.test(line)) : [];
  // Vaults built by other systems keep their rules in another layout (for example "## 1. ..." headings).
  // Without numbered lines under "## Standing rules", the whole note goes in, and prompt-route is told
  // so through a marker, so the first message does not inject it a second time.
  if (!rules.length) {
    rules = agreements === null ? ['Knowledge/Working Agreements.md was not found, so no standing rules were loaded.']
      : ['(The full Knowledge/Working Agreements.md note follows: it has no numbered "## Standing rules" section.)',
        agreements.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim().slice(0, c.inject.maxNoteChars)];
    if (agreements !== null && input.session_id) {
      try { const m = X.fullRulesMarker(c, input.session_id); fs.mkdirSync(require('path').dirname(m), { recursive: true }); fs.writeFileSync(m, String(Date.now())); }
      catch (e) { C.logError(e); }
    }
  }
  const digests = V.list(c, 'Log/sessions').filter(e => e.fm.type === 'session')
    .sort((a, b) => String(b.fm.updated || '').localeCompare(String(a.fm.updated || '')) || a.rel.localeCompare(b.rel))
    .slice(0, 5).map(e => ['about', 'machine', 'updated', 'status']
      .map(name => name + ': ' + String(e.fm[name] || '').replace(/[\r\n]/g, ' ')).join(' | '));
  const context = ['[continuum] Start page', page, '[continuum] Standing rules', ...rules];
  // inject.digests "full": the text of the five newest files in Log/sessions (by modified time), each cut
  // at maxNoteChars. The default "summary" keeps the one metadata line per session above.
  if (c.inject.digests === 'full') {
    const full = V.list(c, 'Log/sessions').map(e => ({ e, t: fs.statSync(e.file).mtimeMs }))
      .sort((a, b) => b.t - a.t || a.e.rel.localeCompare(b.e.rel)).slice(0, 5)
      .map(({ e }) => '--- ' + e.rel + ' ---\n' + e.text.slice(0, c.inject.maxNoteChars));
    if (full.length) context.push('[continuum] Recent sessions (full text)', ...full);
  } else if (digests.length) context.push('[continuum] Recent sessions (metadata only)', ...digests);
  // The gate's prompt text is read by the person, so this is the only place the model
  // learns the command behind "saying ok in chat for a whole kind of action".
  if (onCodex) {
    context.push('[continuum] Chat approval', 'Some actions are stopped by the Continuum gate with a reason that ' +
      'starts with [continuum]. When that happens, ask the person one yes or no question in chat naming the exact action. ' +
      'Only after their yes, run the approve command the reason gives, alone, with nothing chained to it: node "' +
      C.pluginPath('scripts', 'approve.js') + '" --host codex <level> "<their words>" (level is one of ' + LEVELS.join(', ') +
      '; their words go inside one pair of double quotes with no double quotes inside), then retry the call. That level ' +
      'is then allowed for ' + (C.ttl(c) / 3600000) + ' hour(s). The same command records a yes the person gives ahead ' +
      'of time for a whole kind of action. Never run it without such words from the person, never after a no, and never for money.',
      // A note delete took three questions on 2026-11-11: Codex made its own copy first, then bundled delete, check and
      // log into one command, which the gate classed system-change. The gate copies and logs by itself (shell-backup.js).
      'To delete, move or empty a note in the notes folder, run one plain command that does only that and names the note ' +
      'by its path. Do not copy the note anywhere first and do not add check or log steps to the command: Continuum copies ' +
      'the note into .backups/<date>/ itself just before the command runs, and writes the decision log lines itself. If the ' +
      'gate stops the command, ask the person one yes or no question that names the note; after their yes, run the approve ' +
      'line alone, then the same plain command again, alone. Never ask the person to approve system-change for a note ' +
      'delete: if the gate answers system-change for a command that was only meant to change a note, the command was ' +
      'bundled with something else, so split it and run only the plain delete. The steps in AGENTS.md under "When the hooks ' +
      'did not run" (copy into .backups, write the log line, write the digest) apply only when no [continuum] text was ' +
      'loaded in this chat.');
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context.join('\n\n') } };
  }
  if (C.host.isHermes()) {
    context.push('[continuum] Chat approval', 'For a gated action (deleting or emptying vault notes, sending mail, changing ' +
      'an outside system or settings, a note that duplicates another) Hermes shows the person its own Yes/No approval card ' +
      'with a reason that starts with [continuum]; the answer is theirs. Money is always refused. When the person says in chat ' +
      'that a whole kind of gated action may go ahead for a while, record their exact words by running this command alone: node "' +
      C.pluginPath('scripts', 'approve.js') + '" --host hermes <level> "<their words>" (level is one of ' + LEVELS.join(', ') +
      '). That level then skips the card for ' + (C.ttl(c) / 3600000) + ' hour(s). Never run it without such words, ' +
      'never after a No, and never for money.');
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context.join('\n\n') } };
  }
  context.push('[continuum] Chat approval', 'When the person says in chat that a whole kind of gated action may go ahead ' +
    'for a while (for example "you may delete notes for the next hour"), record their exact words by running this command ' +
    'alone, with nothing chained to it: node "' + C.pluginPath('scripts', 'approve.js') + '" <level> "<their words>" ' +
    '(level is one of ' + LEVELS.join(', ') + '; their words go inside one pair of double quotes with no double quotes ' +
    'inside). That level then skips the permission prompt for ' + (C.ttl(c) / 3600000) + ' hour(s); it cannot be made ' +
    'shorter. If the person named a shorter time than that, tell them how long it will really last and run the command ' +
    'only on their yes. Never run it without such words from the person, never after they answered No at a prompt, ' +
    'and never for money.');
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context.join('\n\n') } };
}
if (require.main === module) C.hook('SessionStart', start);
module.exports = { start };
