'use strict';
const fs = require('fs');
const C = require('./lib/config');
const V = require('./lib/vault');
const { LEVELS } = require('./approve');
const X = require('./lib/codex');
const F = require('./lib/filing');

// How a note is found. In the start text, not only in the starter notes, because an existing notes folder never
// gets new starter notes; and ahead of the start page and the rules, so that when a host keeps only the start of
// this text a long start page or long rules do not push it out. Only the short warning lines come before it.
// It is left out only when both hold: the loaded rules say it themselves (SAID: one sentence each of starter rules
// 10 and 11), and the whole start text fits in what the host keeps (KEEPS; on Codex the installed limit), so those
// rules do reach the assistant. Said twice it would only use up start text. Reword or remove either rule, or let
// the start text outgrow the host, and the block is back.
const SAID = ['One note read is not the notes checked', 'I could not find a definite answer'];
// The Claude app hands over a hook's output as a short preview once it passes 10,000 characters (seen November 2026);
// Hermes spills above its own setting, 16,000 by default. The smallest is used for every host but Codex.
const KEEPS = 10000;
const FINDING = ['[continuum] Finding notes', 'A note reaches you by its lookup words (when_to_use words in the message: ' +
  'it is loaded for you), by a link from another note (open it yourself) or by search (no lookup word, nothing loaded: ' +
  'search every note yourself). When the person asks about or refers to something the notes may hold, read each note in ' +
  'full and follow its links to the end (a note already read is an end) before you answer or state a fact. Then give ' +
  'the correct answer, or "I could not find a definite answer" with where you looked.'];

// The start text, built without writing anything (status.js measures it too). context.marker: the whole Working
// Agreements note went in uncut, so prompt-route need not load it again on the first message.
function build(c, entries) {
  const onCodex = C.host.isCodex();
  // Loaded text is never cut silently: F.fit keeps whole lines and says what is missing and where it is.
  const page = F.fit(fs.readFileSync(C.vaultPath(c, c.inject.startPage), 'utf8'), c.inject.maxNoteChars, c.inject.startPage);
  let agreements = null;
  try { agreements = fs.readFileSync(C.vaultPath(c, 'Knowledge', 'Working Agreements.md'), 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const wa = F.agreements(agreements);
  let rules = wa.rules;
  let marker = false;
  // Vaults built by other systems keep their rules in another layout (for example "## 1. ..." headings).
  // Without numbered lines under "## Standing rules", the whole note goes in, and prompt-route is told
  // so through a marker (only when it went in uncut), so the first message does not inject it a second time.
  if (!rules.length) {
    const whole = agreements === null ? null : F.fit(wa.whole, c.inject.maxNoteChars, 'Knowledge/Working Agreements.md');
    rules = agreements === null ? ['Knowledge/Working Agreements.md was not found, so no standing rules were loaded.']
      : ['(The full Knowledge/Working Agreements.md note follows: it has no numbered "## Standing rules" section.)', whole];
    marker = agreements !== null && whole === wa.whole;
  }
  const digests = V.list(c, 'Log/sessions').filter(e => e.fm.type === 'session')
    .sort((a, b) => String(b.fm.updated || '').localeCompare(String(a.fm.updated || '')) || a.rel.localeCompare(b.rel))
    .slice(0, 5).map(e => ['about', 'machine', 'updated', 'status']
      .map(name => name + ': ' + String(e.fm[name] || '').replace(/[\r\n]/g, ' ')).join(' | '));
  const context = ['[continuum] Start page', page, '[continuum] Standing rules', ...rules];
  // Hermes does not work from inside the notes folder, so the text has to name it. Seen on a real Hermes on
  // 2026-11-18, on a computer with three folders whose names start with Continuum: Hermes guessed which one
  // was its own, and in another chat searched the home folder for a note by name. After the start page, so
  // the text still opens the way every host's start text does. Antigravity is the same when Continuum is a
  // plugin for every folder: a conversation with no folder open has nothing that names the notes folder (seen
  // on 2026-11-23: asked to change a note, Antigravity ran a check and read the settings file to find it).
  if (C.host.isHermes() || C.host.isAntigravity()) context.splice(2, 0, '[continuum] Notes folder', 'Your Continuum notes are in this folder:\n' +
    C.oneLine(c.vault) + '\nEvery note named in this text (Home.md, Knowledge/..., Log/...) is inside it. Use this folder for ' +
    'your Continuum notes; do not take another folder with a similar name for it.');
  // First, so a host limit on start text (Codex: additionalContextLimit) cannot drop them: an unfinished
  // split, then notes over the load limit. Each only when it applies.
  const first = [];
  for (const make of [() => F.unfinishedLines(c).map(l => l.text), () => [F.startLine(c, F.sizes(c, entries || V.list(c)))]]) {
    try { first.push(...make()); } catch (e) { C.logError(e); }
  }
  const lead = first.filter(Boolean);
  context.unshift(...lead);
  // inject.digests "full": the text of the five newest files in Log/sessions (by modified time), each cut
  // at maxNoteChars. The default "summary" keeps the one metadata line per session above.
  if (c.inject.digests === 'full') {
    const full = V.list(c, 'Log/sessions').map(e => ({ e, t: fs.statSync(e.file).mtimeMs }))
      .sort((a, b) => b.t - a.t || a.e.rel.localeCompare(b.e.rel)).slice(0, 5)
      .map(({ e }) => '--- ' + e.rel + ' ---\n' + F.fit(e.text, c.inject.maxNoteChars, e.rel));
    if (full.length) context.push('[continuum] Recent sessions (full text)', ...full);
  } else if (digests.length) context.push('[continuum] Recent sessions (metadata only)', ...digests);
  context.marker = marker;
  chat(c, context, onCodex);
  const loaded = rules.join('\n');
  let keeps = KEEPS;
  if (onCodex) { try { keeps = F.codexLimit(c); } catch (e) { C.logError(e); } }
  if (!(SAID.every(s => loaded.includes(s)) && context.join('\n\n').length <= keeps)) context.splice(lead.length, 0, ...FINDING);
  return context;
}
// The host's own lines on approving in chat, appended last.
function chat(c, context, onCodex) {
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
    return context;
  }
  if (C.host.isHermes()) {
    context.push('[continuum] Chat approval', 'For a gated action (deleting or emptying vault notes, sending mail, changing ' +
      'an outside system or settings, a note that duplicates another) Hermes shows the person its own Yes/No approval card ' +
      'with a reason that starts with [continuum]; the answer is theirs. Money is always refused. When the person says in chat ' +
      'that a whole kind of gated action may go ahead for a while, record their exact words by running this command alone: node "' +
      C.pluginPath('scripts', 'approve.js') + '" --host hermes <level> "<their words>" (level is one of ' + LEVELS.join(', ') +
      '). That level then skips the card for ' + (C.ttl(c) / 3600000) + ' hour(s). Never run it without such words, ' +
      'never after a No, and never for money.');
    return context;
  }
  // Antigravity: the gate answers force_ask, so the person decides in Antigravity's own permission prompt, as in
  // Claude Code; the approve line carries --host antigravity because the model's shell does not select the host.
  const onAg = C.host.isAntigravity();
  context.push('[continuum] Chat approval', (onAg ? 'For a gated action Antigravity shows the person its own permission ' +
    'prompt with a reason that starts with [continuum]; the answer is theirs, and money is always refused. ' : '') +
    'When the person says in chat that a whole kind of gated action may go ahead ' +
    'for a while (for example "you may delete notes for the next hour"), record their exact words by running this command ' +
    'alone, with nothing chained to it: node "' + C.pluginPath('scripts', 'approve.js') + '" ' + (onAg ? '--host antigravity ' : '') + '<level> "<their words>" ' +
    '(level is one of ' + LEVELS.join(', ') + '; their words go inside one pair of double quotes with no double quotes ' +
    'inside). That level then skips the permission prompt for ' + (C.ttl(c) / 3600000) + ' hour(s); it cannot be made ' +
    'shorter. If the person named a shorter time than that, tell them how long it will really last and run the command ' +
    'only on their yes. Never run it without such words from the person, never after they answered No at a prompt, ' +
    'and never for money.');
  return context;
}
function start(input, c) {
  // The Codex desktop app starts side sessions at the same moment, so on Codex a failed
  // index rebuild (another firing writing the same file) must not cost the context.
  let entries;
  if (C.host.fromInputs()) { try { entries = V.buildIndex(c); } catch (e) { C.logError(e); } } else entries = V.buildIndex(c);
  const context = build(c, entries);
  if (context.marker && input.session_id) {
    try { const m = X.fullRulesMarker(c, input.session_id); fs.mkdirSync(require('path').dirname(m), { recursive: true }); fs.writeFileSync(m, String(Date.now())); }
    catch (e) { C.logError(e); }
  }
  // Codex keeps only the first additionalContextLimit characters of this text; past that, it is said first.
  let text = context.join('\n\n');
  if (C.host.isCodex()) { try { const line = F.codexLine(c, text.length); if (line) text = line + '\n\n' + text; } catch (e) { C.logError(e); } }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}
if (require.main === module) C.hook('SessionStart', start);
module.exports = { start, build };
