'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./lib/config');
const V = require('./lib/vault');
const X = require('./lib/codex');
const clip = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);
function textOf(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text).join('\n') : '';
}
// Codex: the transcript is not a stable format, so the digest comes from hook inputs kept in a
// per-session state file. A digest is written only for a session that has both a submitted prompt
// and a Stop with a non-empty assistant reply; side sessions without both leave no file.
function codexDigest(input, c) {
  if (input.stop_hook_active || !c.digests || !input.session_id) return {};
  const sid = String(input.session_id);
  const event = input.hook_event_name;
  const state = X.readState(c, sid);
  const now = new Date().toISOString();
  if (event === 'UserPromptSubmit' && typeof input.prompt === 'string' && input.prompt.trim()) {
    const text = clip(input.prompt, 400);
    if (!state.first) state.first = { text, ts: now };
    state.prompts = [...(Array.isArray(state.prompts) ? state.prompts : []), { text, ts: now }].slice(-5);
  } else if (event === 'Stop' && typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()) {
    state.reply = clip(input.last_assistant_message, 400);
  } else if (event === 'SessionEnd') state.closed = true;
  else return {};
  X.writeState(c, sid, state);
  if (!state.first || !state.reply) return {};
  const safe = sid.replace(/[^a-z0-9_-]/gi, '_').slice(0, 12);
  const prior = V.list(c, 'Log/sessions').find(e => e.fm.session === sid && e.fm.machine === c.machine);
  const started = prior && prior.fm.started ? prior.fm.started : C.stamp(c, new Date(state.first.ts));
  const file = prior ? prior.file : C.vaultPath(c, 'Log', 'sessions', started.slice(0, 10) + ' ' + c.machine + ' ' + C.host.name() + ' ' + safe + '.md');
  if (fs.existsSync(file) && !prior) throw new Error('Session filename collision; existing digest preserved');
  const closed = state.closed || (prior && prior.fm.status === 'closed');
  const fm = { type: 'session', pattern: 'session-digest', about: clip(state.first.text, 70), machine: c.machine,
    host: C.host.name(), session: sid, started, updated: C.stamp(c), status: closed ? 'closed' : 'open' };
  const body = ['---', ...Object.entries(fm).map(([name, value]) => name + ': ' + JSON.stringify(value)),
    '---', '# Session digest', '', '**Started with:** ' + clip(state.first.text, 200), '',
    "**The person's last messages:**", ...state.prompts.map(u => '- ' + clip(u.text, 200)), '',
    '**Last reply (clipped):** ' + clip(state.reply, 300), ''];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, body.join('\n'), 'utf8');
  fs.renameSync(tmp, file);
  return {};
}
function digest(input, c) {
  if (C.host.fromInputs()) return codexDigest(input, c);
  if (input.stop_hook_active || !c.digests || !input.session_id || !input.transcript_path) return {};
  const users = [];
  // The first message of a session can arrive before the transcript file exists.
  const source = C.transcriptPath(c, input.transcript_path);
  const transcript = fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : '';
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch (_) { continue; }
    if (row.type !== 'user' || row.isMeta || row.isSidechain || !row.message) continue;
    const text = textOf(row.message.content).trim();
    if (text) users.push({ text, timestamp: row.timestamp });
  }
  // Stop does not run when the person interrupts a turn, so the digest is also written
  // when a message is submitted. That message may not be in the transcript yet.
  const prompt = input.hook_event_name === 'UserPromptSubmit' && typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (prompt && !(users.length && users[users.length - 1].text === prompt)) {
    users.push({ text: prompt, timestamp: new Date().toISOString() });
  }
  if (!users.length) return {};
  const sid = String(input.session_id);
  const safe = sid.replace(/[^a-z0-9_-]/gi, '_').slice(0, 12);
  const firstDate = new Date(users[0].timestamp);
  let started = C.stamp(c, Number.isNaN(firstDate.getTime()) ? new Date() : firstDate);
  const directory = C.vaultPath(c, 'Log', 'sessions');
  fs.mkdirSync(directory, { recursive: true });
  const prior = V.list(c, 'Log/sessions').find(e => e.fm.session === sid && e.fm.machine === c.machine);
  // A message-only snapshot must not replace a digest built from a transcript that is now missing.
  if (prior && !fs.existsSync(source)) return {};
  if (prior && prior.fm.started) started = prior.fm.started;
  const file = prior ? prior.file : C.vaultPath(c, 'Log', 'sessions',
    started.slice(0, 10) + ' ' + c.machine + ' ' + safe + '.md');
  if (fs.existsSync(file) && !prior) {
    throw new Error('Session filename collision; existing digest preserved');
  }
  // A digest that is already closed stays closed: a late Stop must not reopen it.
  const closed = input.hook_event_name === 'SessionEnd' || (prior && prior.fm.status === 'closed');
  const fm = { type: 'session', pattern: 'session-digest', about: clip(users[0].text, 70),
    machine: c.machine, session: sid, started, updated: C.stamp(c),
    status: closed ? 'closed' : 'open' };
  const body = ['---', ...Object.entries(fm).map(([name, value]) => name + ': ' + JSON.stringify(value)),
    '---', '# Session digest', '', '**Started with:** ' + clip(users[0].text, 200), '',
    "**The person's last messages:**", ...users.slice(-5).map(u => '- ' + clip(u.text, 200)), ''];
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, body.join('\n'), 'utf8');
  fs.renameSync(tmp, file);
  return {};
}
if (require.main === module) C.hook('Stop', digest);
module.exports = { digest };
