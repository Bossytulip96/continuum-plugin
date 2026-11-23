'use strict';
// The one entry point for every Google Antigravity hook: node ./scripts/antigravity-hook.js <Event>
// (Event is SessionStart, PreInvocation, PreToolUse or Stop). It selects the antigravity host itself, so the
// hook command needs no --host. Stdin is translated to the shape the other hooks take, the same functions run,
// and the answer is translated back. It always exits 0 and always prints one JSON object, even on empty or
// broken stdin (a non-zero exit would only be logged and ignored by Antigravity). The gate fails closed: a
// PreToolUse it cannot evaluate is denied. Every other event fails open.
const host = require('./lib/host');
host.set('antigravity');
const fs = require('fs');
const C = require('./lib/config');
const A = require('./lib/antigravity');

const event = A.EVENTS.includes(process.argv[2]) ? process.argv[2] : '';

async function handle(raw, c) {
  if (event === 'SessionStart') {
    return A.inject(A.contextOf(require('./session-start').start(A.toInternal('SessionStart', raw), c)));
  }
  if (event === 'PreToolUse') {
    // An input with no tool name cannot be evaluated: thrown here, denied by the fail-closed handler below.
    if (!A.hasTool(raw)) throw new Error('the hook input names no tool');
    // The gate's own deny (money, a failed backup) and its asks come back through the same translation.
    return A.decision(require('./action-gate').handle(A.toInternal('PreToolUse', raw), c));
  }
  if (event === 'Stop') {
    const input = A.toInternal('Stop', raw);
    // Through the from-inputs digest path; the answer is always {} so the stop is never held back.
    require('./session-digest').digest(input, c);
    return {};
  }
  if (event === 'PreInvocation') {
    const input = A.toInternal('PreInvocation', raw);
    const file = A.stateFile(C.configFile(c, '.'), input.session_id);
    const state = A.readState(file);
    // The count of the person's messages is needed only on the first call of a turn.
    const count = raw.invocationNum === 0 ? A.userInputs(input.transcript_path || '') : undefined;
    const isNew = A.isNewMessage(state, raw, count);
    let text = '';
    let routed = isNew;
    // The message is marked as routed only after routing worked, so a failure is tried again on the next call.
    if (isNew) {
      try { text = A.contextOf(require('./prompt-route').route(input, c)); } catch (e) { routed = false; C.logError(e); }
      try { require('./session-digest').digest(input, c); } catch (e) { C.logError(e); }
    }
    A.writeState(file, A.nextState(state, raw, routed, isNew && !routed, count));
    return A.inject(text);
  }
  return A.empty(event);
}

if (require.main === module) {
  // Not set up yet: stay silent with a valid answer (the plugin may be installed before setup runs).
  let ready = false;
  try { ready = fs.existsSync(C.configPath()); } catch (_) { /* treated as not set up */ }
  if (!event || !ready) {
    try { if (!ready) fs.readFileSync(0, 'utf8'); } catch (_) { /* stdin is optional */ }
    process.stdout.write(JSON.stringify(A.empty(event)) + '\n');
    process.exitCode = 0;
  } else {
    C.hook(event, handle, e => (event === 'PreToolUse'
      ? { decision: 'deny', reason: '[continuum] The gate could not evaluate this call (' + String(e.message || e) +
        '); denied. Fix the cause or run setup again.' }
      : {}));
  }
}
module.exports = { handle };
