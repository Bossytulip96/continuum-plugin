'use strict';
// Pure helpers for Google Antigravity (see scripts/antigravity-hook.js): Antigravity's hook shapes
// (camelCase stdin, injectSteps and decision stdout) to and from the shapes the Node hooks already take.
// Built from the docs at antigravity.google/docs/hooks.md and /build-plugins.md (read 2026-11-22) and from a
// live capture on the Antigravity App 2.34.0 the same day. Seen live: the stdin also carries cwd (may be empty),
// hookEventName and toolCall.id; systemMessage steps reach the model from SessionStart and PreInvocation; Stop
// sends terminationReason and fullyIdle. The App's tool names are NOT the documented ones: read_file {Path},
// write_file {Path, Content, Overwrite, Append}, edit_file {Path, Target, Replacement}, run_command
// {CommandLine} with no Cwd, run_workflow {Script, ScriptPath}, call_mcp_tool {ServerName, ToolName, Arguments},
// and plugin MCP tools named mcp_<plugin>_<server>_<tool>. Both sets of names are handled.
// Claude Code, Codex and Hermes never load this file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Antigravity's own settings: global and workspace hooks, installed plugins, the app config.
// They count as system settings when Antigravity is the host, like CODEX_CONFIG_PATH for Codex.
// A plugin folder inside a workspace (.agents/plugins) counts too: its hooks.json is what runs Continuum there.
const CONFIG_PATH = /(?:^|[\\/])(?:\.gemini[\\/]config[\\/](?:hooks\.json|config\.json|plugins(?:[\\/]|$))|\.agents[\\/](?:hooks\.json|plugins(?:[\\/]|$)))/i;
// Built-in tool names, from the docs and from the App. Every other name is treated as a possible MCP tool (below).
const BUILTIN = new Set(['view_file', 'read_file', 'list_dir', 'find_by_name', 'grep_search', 'search_web', 'read_url_content',
  'manage_task', 'schedule', 'list_permissions', 'ask_permission', 'invoke_subagent', 'define_subagent', 'send_message',
  'manage_subagents', 'ask_question', 'generate_image', 'swarm', 'update_focus', 'update_steps', 'list_plugin_accounts',
  'search_marketplace', 'list_resources', 'read_resource']);
// The verbs the gate's MCP rule starts an action with; used only to choose where server ends and action begins.
const VERB = /^(?:create|update|delete|remove|apply|publish|set|enable|disable|send|post|put|patch|archive|trash|move|rename|upload|write|reply|forward|add|insert|append|merge|close|cancel|escalate|snooze|trigger|unlist|discard|restore|link|pin|transfer|purchase|checkout|pay|wire)(?:_|-|$)/i;

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = v => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const hash = text => crypto.createHash('sha256').update(String(text)).digest('hex');

// The exact MCP tool name format is NOT confirmed. The docs' matcher example is mcp_.*, and a plugin's
// server is named <plugin-name>_<server-key>. The name is turned into the gate's mcp__<server>__<action>
// with the split put before the first part that starts with a mutating verb (else after the first part),
// so "mcp_mail_send_message" and "mcp_my_server_delete_item" both reach the gate's MCP rules.
// A camelCase action (transferFunds, deleteItem) is written with underscores first, because the gate's money,
// mail and mutating-verb rules look for whole words between underscores.
const snake = text => text.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
function mcpName(name) {
  const full = name.match(/^mcp__(.+?)__(.+)$/i);
  if (full) return 'mcp__' + full[1] + '__' + snake(full[2]);
  const parts = snake(name.replace(/^mcp_/i, '')).split('_');
  if (parts.length < 2 || parts.some(p => !p)) return name;
  let at = 1;
  for (let i = 1; i < parts.length; i++) if (VERB.test(parts.slice(i).join('_'))) { at = i; break; }
  return 'mcp__' + parts.slice(0, at).join('_') + '__' + parts.slice(at).join('_');
}
function cwdOf(input, args) {
  const ws = Array.isArray(input.workspacePaths) ? input.workspacePaths.find(p => typeof p === 'string' && p) : '';
  return str(args.Cwd) || str(input.cwd) || ws || process.cwd();
}
// The argument that names the file, whatever the tool calls it (App: Path; docs: TargetFile, AbsolutePath).
const fileArg = args => str(args.Path) || str(args.TargetFile) || str(args.AbsolutePath) || str(args.FilePath);
const shellName = platform => (platform === 'win32' ? 'PowerShell' : 'Bash');
// Fields every internal input carries.
function base(input, event, args = {}) {
  return { session_id: str(input.conversationId) || 'antigravity', transcript_path: str(input.transcriptPath) || null,
    cwd: cwdOf(input, args), hook_event_name: event };
}
// Antigravity tool call -> the tool name and input the gate understands. Other tools keep their own name.
function tool(call, platform = process.platform, cwd = '') {
  const name = str(call.name);
  const args = obj(call.args);
  const named = fileArg(args);
  if (name === 'write_file' || name === 'write_to_file' || name === 'create_file') {
    const content = str(args.Content) || str(args.CodeContent);
    // An append never empties a note, so it is not handed over as an empty write.
    return { tool_name: 'Write', tool_input: { file_path: named, content: args.Append ? content || 'appended' : content } };
  }
  if (name === 'edit_file' || name === 'replace_file_content') {
    return { tool_name: 'Edit', tool_input: { file_path: named, old_string: str(args.Target) || str(args.TargetContent),
      new_string: str(args.Replacement) || str(args.ReplacementContent), replace_all: Boolean(args.AllowMultiple) } };
  }
  if (name === 'multi_replace_file_content') {
    // The chunk fields are not defined in the docs; TargetContent/ReplacementContent are assumed, as in
    // replace_file_content. One chunk is checked as one Edit. Several are applied in order to the file as it
    // is now and handed over as one Edit of the whole text, so the gate's "edit empties the note" check sees
    // the end result. A file that cannot be read keeps old_string empty: path rules and the backup still run.
    const chunks = Array.isArray(args.ReplacementChunks) ? args.ReplacementChunks.map(obj) : [];
    const file = str(args.TargetFile);
    if (chunks.length > 1) {
      try {
        // Read from the same place the gate resolves the path to: a relative path belongs to the call's folder.
        const current = fs.readFileSync(path.isAbsolute(file) || !cwd ? file : path.resolve(cwd, file), 'utf8');
        let result = current;
        for (const ch of chunks) {
          const from = str(ch.TargetContent);
          if (from) result = ch.AllowMultiple ? result.split(from).join(str(ch.ReplacementContent)) : result.replace(from, () => str(ch.ReplacementContent));
        }
        if (current) return { tool_name: 'Edit', tool_input: { file_path: file, old_string: current, new_string: result, replace_all: false } };
      } catch (_) { /* unreadable or relative path: fall through */ }
    }
    const one = chunks.length === 1 ? chunks[0] : {};
    return { tool_name: 'Edit', tool_input: { file_path: file, old_string: str(one.TargetContent),
      new_string: str(one.ReplacementContent), replace_all: Boolean(one.AllowMultiple) } };
  }
  // Scanned as PowerShell on Windows, the way the Codex and Hermes shells are.
  if (name === 'run_command') return { tool_name: shellName(platform), tool_input: { command: str(args.CommandLine) } };
  // run_workflow runs a script, given inline or by path: it is scanned like a shell command.
  if (name === 'run_workflow') return { tool_name: shellName(platform), tool_input: { command: [str(args.Script), str(args.ScriptPath)].join(' ').trim() } };
  // The App's general door to any MCP server. A call that names no server or tool cannot be classified, so it is
  // handed over as a change to an outside system and the person is asked.
  if (name === 'call_mcp_tool') {
    const server = str(args.ServerName).trim(); const action = str(args.ToolName).trim();
    return { tool_name: server && action ? 'mcp__' + server + '__' + snake(action) : 'mcp__unknown__update_unknown', tool_input: obj(args.Arguments) };
  }
  if (BUILTIN.has(name) || /^browser_/i.test(name) || !name.includes('_')) return { tool_name: name, tool_input: args };
  // A file tool this adapter does not know by name (delete_file, move_file, apply_patch ...) still names its file:
  // a remover is handed over as a shell delete of that file and a writer as an edit of it, so the vault rules
  // and the dated copy run for it.
  if (named && !/^mcp_/i.test(name)) {
    if (/(?:^|_)(?:delete|remove|move|rename|trash)(?:_|$)/i.test(name)) return { tool_name: shellName(platform), tool_input: { command: (platform === 'win32' ? 'Remove-Item "' : 'rm "') + named + '"' } };
    if (/(?:^|_)(?:write|edit|create|patch|replace|append|update|insert)(?:_|$)/i.test(name)) return { tool_name: 'Edit', tool_input: { file_path: named, old_string: '', new_string: '' } };
  }
  return { tool_name: mcpName(name), tool_input: args };
}
// Levels the gate adds on Antigravity by itself: schedule with a cron or a delay creates a scheduled task.
// The App's Google plugins (Gmail, Calendar, Drive, Sheets) are command-line tools run through run_command, with
// their changing commands under "mutate" (read in the installed plugins, 2026-11-22). Sending, replying to and
// forwarding mail is email-send; every other change is a change to an outside system. The older flat forms
// (gmail send ...) still work in those tools, so the usual changing verbs are matched there as well. The tool
// has to start the command or follow a separator, so words quoted inside another command do not count.
const GOOGLE_CLI = /(?:^\s*|[;&|(\r\n]\s*|\bcall\s+)["']?(?:[^"'\s;&|]*[\\/])?(gmail|gcalendar|gdrive|gsheets)(?:\.cmd)?["']?\s+(mutate\s+)?([a-z][a-z-]*)/gi;
const MAIL_OUT = /^(?:send|send-with-attachment|reply|forward)$/i;
const CHANGES = /^(?:create|update|delete|remove|upload|mkdir|write|append|clear|move|trash|untrash|share|unshare|rename|copy|import|find-replace|notes|add|react|send|reply|forward|respond|label|archive|mark)(?:-|$)/i;
function levels(toolName, ti) {
  const t = obj(ti);
  const out = new Set();
  if (toolName === 'schedule' && (str(t.CronExpression).trim() || Number(t.DurationSeconds) > 0)) out.add('system-change');
  if (toolName === 'PowerShell' || toolName === 'Bash') {
    for (const m of str(t.command).matchAll(GOOGLE_CLI)) {
      if (m[1].toLowerCase() === 'gmail' && MAIL_OUT.test(m[3])) out.add('email-send');
      else if (m[2] || CHANGES.test(m[3])) out.add('vendor-write');
    }
  }
  return [...out];
}
// App 2.34.0 (seen live) writes the transcript as one JSON object per line; a model step has source "MODEL" and
// its text in content, a person's message has type "USER_INPUT". Only a reply that comes after the last message
// counts, so an older reply is never taken for this turn's. Any other shape, or no file, gives ''.
function lastReply(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      const step = obj(JSON.parse(lines[i]));
      if (step.type === 'USER_INPUT') return '';
      if (step.source === 'MODEL' && typeof step.content === 'string' && step.content.trim()) return step.content;
    }
  } catch (_) { /* reported as no reply */ }
  return '';
}
function toInternal(event, raw) {
  const input = obj(raw);
  if (event === 'PreToolUse') {
    const call = obj(input.toolCall);
    const b = base(input, 'PreToolUse', obj(call.args));
    return { ...b, ...tool(call, process.platform, b.cwd) };
  }
  if (event === 'Stop') {
    // Antigravity hands hooks no reply text and the from-inputs digest needs one: the reply is read from the
    // transcript when it has the shape seen live, and otherwise the stop itself stands in.
    const why = str(input.terminationReason) || (input.fullyIdle ? 'idle' : 'stopped');
    return { ...base(input, 'Stop'), stop_hook_active: false, last_assistant_message: lastReply(str(input.transcriptPath)) ||
      '(Antigravity does not pass the reply to hooks; the turn ended: ' + why + ')' };
  }
  if (event === 'SessionStart') return { ...base(input, 'SessionStart'), source: 'startup' };
  return { ...base(input, 'UserPromptSubmit'), prompt: str(input.lastUserInput) };
}
const contextOf = answer => str(obj(obj(answer).hookSpecificOutput).additionalContext);
const inject = text => (text ? { injectSteps: [{ systemMessage: { systemMessage: text } }] } : {});
// Gate answer -> Antigravity decision. "ask" becomes force_ask so a cached Always Allow cannot skip the click.
function decision(answer) {
  const h = obj(obj(answer).hookSpecificOutput);
  const reason = str(h.permissionDecisionReason);
  if (h.permissionDecision === 'deny') return { decision: 'deny', reason: reason || '[continuum] denied' };
  if (h.permissionDecision === 'ask') return { decision: 'force_ask', reason: reason || '[continuum] needs your yes' };
  return { decision: 'allow' };
}
// PreInvocation fires before every model call, so one message is routed once. Seen live (App 2.34.0):
// invocationNum restarts at 0 on every turn and counts up within it, initialNumSteps grows with every model call,
// and a turn started by a system message (another agent, a timer) leaves lastUserInput as it was. So: a text
// that differs from the last routed one is new; the same text is new only on the first call of a turn AND when
// the transcript shows one more message from the person than when it was last routed. When that cannot be
// told (no transcript, another shape), the same text is not loaded again: its notes are already in the chat.
function isNewMessage(state, input, count) {
  const text = str(input.lastUserInput).trim();
  if (!text) return false;
  if (hash(text) !== state.lastHash || state.pending === hash(text)) return true; // pending: its routing failed, try again
  if (input.invocationNum !== 0) return false;
  return typeof count === 'number' && typeof state.userInputs === 'number' && count > state.userInputs;
}
// How many messages from the person the transcript holds (one JSON object per line, type "USER_INPUT").
function userInputs(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => /"type"\s*:\s*"USER_INPUT"/.test(l)).length; }
  catch (_) { return undefined; }
}
function stateFile(dir, sid) { return path.join(dir, 'antigravity-sessions', hash(sid).slice(0, 32) + '.json'); }
function readState(file) {
  try { return obj(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { return {}; }
}
function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
// What PreInvocation records: the call number; on a routed message also its hash and the count of the
// person's messages at that moment.
function nextState(state, input, routed, failed = false, count) {
  const out = { ...state, lastInvocation: input.invocationNum };
  const h = hash(str(input.lastUserInput).trim());
  // The count is known only on the first call of a turn, so a failed first call keeps it for the retry.
  const known = typeof count === 'number' ? count : out.pendingCount;
  if (routed) { out.lastHash = h; delete out.pending; delete out.pendingCount; if (typeof known === 'number') out.userInputs = known; else delete out.userInputs; }
  if (failed) { out.pending = h; if (typeof known === 'number') out.pendingCount = known; } // tried again on every later call until one works
  return out;
}
// A PreToolUse input without a tool name cannot be evaluated; the gate then fails closed.
const hasTool = raw => Boolean(str(obj(obj(raw).toolCall).name).trim());
const EVENTS = ['SessionStart', 'PreInvocation', 'PreToolUse', 'Stop'];
// What each event prints when nothing is to be said (PreToolUse needs a decision field).
const empty = event => (event === 'PreToolUse' ? { decision: 'allow' } : {});
module.exports = { CONFIG_PATH, EVENTS, mcpName, tool, levels, lastReply, toInternal, contextOf, inject, decision,
  isNewMessage, userInputs, nextState, hasTool, stateFile, readState, writeState, empty, hash };
