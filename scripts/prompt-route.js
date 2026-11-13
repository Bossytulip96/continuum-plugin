'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./lib/config');
const V = require('./lib/vault');
const P = require('./proposal');
const D = require('./decision-log');
const X = require('./lib/codex');

function route(input, c) {
  const prompt = String(input.prompt || '').toLowerCase();
  // On Codex one message can arrive several times (side sessions); only the first firing of
  // the same text inside a short window writes usage counts and correction lines. All get the context.
  let writes = true;
  if (C.host.fromInputs()) { try { writes = X.claim(c, String(input.prompt || '')); } catch (err) { C.logError(err); } }
  if (writes && /\b(that['’]s wrong|that is wrong|not what i (asked|meant|wanted)|too (long|much|many)|stop (doing|adding|asking)|i said|don['’]t (do|add|use|say) that|incorrect|you (missed|forgot|ignored|assumed)|why did you|please (stop|don['’]t)|undo)\b/i.test(prompt)) {
    D.append(c, 'correction (candidate)', 'correction', 'candidate', String(input.prompt).slice(0, 120));
  }
  const candidates = V.list(c, 'Knowledge').filter(e => V.readFm(e.text))
    .map(e => ({ ...e, score: V.matches(e.fm.when_to_use, prompt) }))
    .filter(e => e.score > 0 && !/^(parked|superseded)$/i.test(e.fm.status || ''))
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.rel.localeCompare(b.rel))
    .slice(0, c.inject.maxNotesPerPrompt);
  const parts = [];
  // The start load may already have carried the whole Working Agreements note (see session-start);
  // its marker is used once, on this first message, and removed.
  let rulesLoaded = false;
  if (input.session_id) {
    try { const m = X.fullRulesMarker(c, input.session_id); if (fs.existsSync(m)) { rulesLoaded = true; fs.unlinkSync(m); } }
    catch (err) { C.logError(err); }
  }
  if (candidates.length) {
    parts.push('[continuum] Vault notes loaded for this message');
    for (const e of candidates) {
      parts.push(rulesLoaded && e.rel === 'Knowledge/Working Agreements.md'
        ? '--- ' + e.rel + ' --- (already loaded in full at the start of this session)'
        : '--- ' + e.rel + ' ---\n' + e.text.slice(0, c.inject.maxNoteChars));
      // The usage fields are rewritten from a fresh read of the file, never from the
      // snapshot above, so a save made meanwhile is kept. A file that is not valid
      // UTF-8 is injected but left untouched: rewriting it would corrupt its bytes.
      if (!writes) continue;
      try {
        const bytes = fs.readFileSync(e.file);
        const fresh = bytes.toString('utf8');
        if (!Buffer.from(fresh, 'utf8').equals(bytes)) continue;
        const count = Number((V.readFm(fresh) || {}).times_used);
        const text = V.setFm(fresh, { last_used: C.stamp(c), times_used:
          Number.isSafeInteger(count) && count >= 0 ? count + 1 : 1 });
        const tmp = e.file + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, e.file);
      } catch (err) { C.logError(err); }
    }
  }
  let state = { asked: [] };
  const statePath = input.session_id ? C.sessionFile(c, input.session_id) : null;
  if (statePath && fs.existsSync(statePath)) {
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { /* Rebuild invalid local state. */ }
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = { asked: [] };
  if (!Array.isArray(state.asked)) state.asked = [];
  const proposals = P.load(c).filter(P.open).filter(row => V.matches(row.situation, prompt));
  const hit = proposals.find(row => !state.asked.includes(row.id));
  if (hit) {
    parts.push('[proposal] ' + P.line(hit) + '\nAsk the person for yes, no, or later; record only their actual words.');
    state.asked.push(hit.id);
    if (statePath) {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state) + '\n', 'utf8');
    }
  }
  return parts.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit',
    additionalContext: parts.join('\n\n') } } : {};
}
if (require.main === module) C.hook('UserPromptSubmit', route);
module.exports = { route };
