'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const vault = require('./lib/vault');
const log = require('./decision-log');
const codex = require('./lib/codex'); const { shellGuard, copyable } = require('./lib/shell-backup'); const O = require('./lib/oneliner');

const COPY_NOTE = 'Continuum keeps its own dated copy under .backups; make none yourself. After the yes, run the approve line alone, then the same plain command again, alone.';
const APPROVABLE = ['vault-delete', 'email-send', 'vendor-write', 'system-change', 'new-note'];
// Claude Code shows an "ask" reason to the person in its permission prompt, not to
// the model, so each level is described in words for the person answering Yes or No.
const PLAIN = {
  'vault-delete': 'This would delete, move, empty or rewrite something in your vault, or add to a note by a shell command that keeps no backup copy.',
  'email-send': 'This would send an email.',
  'vendor-write': 'This would change something in an outside system.',
  'system-change': 'This would install something or change settings, hooks or scheduled tasks on this computer.',
  'new-note': 'This would create a note that looks like one you already have.'
};
// Any of these verbs next to a vault path means the notes change without a backup.
// The level stays vault-delete: the person approves shell changes to notes once, by name.
const DESTRUCTIVE = /\b(?:delete|remove|rm|rmdir|rimraf|del|erase|unlink(?:Sync)?|rmSync|rmdirSync|Remove-Item|ri|Clear-Content|clc|mv|move|Move-Item|mi|rename|ren|Rename-Item|rni|cp|copy|Copy-Item|cpi|Set-Content|sc|Add-Content|ac|Out-File|tee|truncate|shred|git\b[^;&|]*\b(?:clean|rm|checkout|restore|reset|stash)|node\s+-e|python3?\s+-c|perl\s+-e|ruby\s+-e|pwsh\s+-c|powershell\s+-c)\b|>/i;
const RECURSIVE = /(?:^|\s)-(?:r|rf|fr|R|Rf|Recurse|recurse)\b|\/s\b|\brmdir\b|\brimraf\b|\bshred\b|\bgit\b[^;&|]*\bclean\b/i;
const SYSTEM = /\b(?:install|schtasks|Register-ScheduledTask|winget|choco|brew|apt|netsh|regedit)\b|\bnpm\s+i\b|\bpip\s+install\b|\bsc\s+create\b|\breg\s+(?:add|delete|import)\b|\bSet-ItemProperty\b.*\bHK[A-Z]{2}\b|\bNew-ItemProperty\b.*\bHK[A-Z]{2}\b/i;
const SHELL_MAIL = /\b(?:Send-MailMessage|sendmail|msmtp|blat|mailx?)\b/i;
// Codex's own settings, hooks and plugin folders count as system settings when Codex is the host.
const CODEX_CONFIG_PATH = /(?:^|[\\/])(?:\.codex[\\/](?:config\.toml|hooks\.json|hooks[\\/]|plugins[\\/])|\.agents[\\/]plugins[\\/])/i;
const CONFIG_PATH =/(?:^|[\\/])(?:\.claude[\\/](?:hooks(?:[\\/]|$)|settings(?:\.local)?\.json(?:$|["'\s]))|\.continuum(?:[\\/]|$))/i;
const SHELL_WRITE = /(?:>|\b(?:Set-Content|Add-Content|Out-File|Remove-Item|rm|del|cp|mv|copy|move|Copy-Item|Move-Item|tee)\b|\bnode\s+-e\b|writeFile|\.write\(|\bopen\([^)]*["']w)/i;
// A redirect that writes nowhere (2>/dev/null, >$null, >NUL, 2>&1) does not turn a read
// into a write, so those are taken out before a command is tested for the > sign.
// Only whole destinations count: >&1note.md is a file, and $null is nothing only in PowerShell.
const END = '(?=$|[\\s;|&)])';
const NOWHERE = new RegExp('(?:\\d|[*&])?>>?\\s*(["\']?)(?:\\/dev\\/null' + (process.platform === 'win32' ? '|nul' : '') +
  ')\\1' + END + '|\\d?>&\\d+' + END, 'gi');
const PS_NULL = new RegExp('(?:\\d|\\*)?>>?\\s*\\$null' + END, 'gi');
function quiet(command, tool) {
  const text = command.replace(NOWHERE, ' ');
  return tool === 'PowerShell' ? text.replace(PS_NULL, ' ') : text;
}
// The setup script edits Claude Code's user settings unless its allowed-folder answer is
// plainly no, however the yes is quoted or spelled.
// The option may be named only once, so a "no" tucked inside another answer does not count.
const SETUP = /\bnode\b[^;&|]*\bsetup\.js\b/i;
const SETUP_NO = /--allow-folder["']?\s+(["']?)no\1(?=\s|$)/i;
const setupAllows = command => SETUP.test(command) && /allow-folder/i.test(command) &&
  !(command.match(/allow-folder/gi).length === 1 && SETUP_NO.test(command));

function decision(value, reason, levels) { // Hermes's adapter reads the levels to name its approval card.
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: value, permissionDecisionReason: reason,
    ...(levels && config.host.isHermes() ? { continuumLevels: levels } : {}) } };
}
function approvals(c) {
  const file = config.configFile(c, 'approvals.json');
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
function validToken(c, token, now = Date.now()) {
  return Boolean(token && typeof token.note === 'string' && token.note.trim() &&
    Number.isFinite(token.issued) && Number.isFinite(token.expires) &&
    token.issued <= now && now - token.issued < config.ttl(c) &&
    token.expires > now && token.expires <= token.issued + config.ttl(c));
}
const slashes = value => String(value).replace(/[/\\]/g, '/').toLowerCase();
// The gate's own approve command carries the person's words as an argument, and
// those words often name a note and say "delete". Only the exact invocation is
// exempt: node, the script, a level, one quoted note, nothing before or after.
function isApproveCommand(command) {
  const m = String(command).match(/^\s*node\s+("[^"]+"|'[^']+'|\S+)\s+(?:--host(?:=|\s+)codex\s+)?([a-z-]+)\s+("[^"]*"|'[^']*'|[^\s;&|<>$`]+)\s*$/i);
  if (!m) return false;
  const script = m[1].replace(/^["']|["']$/g, '');
  return slashes(config.normalize(script)) === slashes(config.pluginPath('scripts', 'approve.js')) &&
    APPROVABLE.includes(m[2].toLowerCase());
}
function commandPaths(c, command, cwd) {
  const parts = [];
  const values = [];
  const rx = /"([^"]*)"|'([^']*)'|([^\s;|&(){}]+?)(?=\s|[;|&(){}]|$)/g;
  let m;
  while ((m = rx.exec(command))) values.push(m[1] ?? m[2] ?? m[3]);
  // A quoted path can sit inside an assignment (f="/c/vault/note.md"; rm "$f"),
  // where the tokenizer above only sees f="/c/vault/note.md, so collect every
  // quoted string on its own as well.
  const quoted = /"([^"]+)"|'([^']+)'/g;
  while ((m = quoted.exec(command))) values.push(m[1] ?? m[2]);
  const code = O.codes(command); values.push(...O.inner(command)); // a one-liner's code is not a path; paths inside it are
  const calls = /\b(?:unlink(?:Sync)?|rmSync|rmdirSync|remove|delete|rm|rename(?:Sync)?|writeFile(?:Sync)?|Path)\s*\(\s*(["'])(.*?)\1/gi;
  while ((m = calls.exec(command))) values.push(m[2]);
  for (let value of values.filter(v => !code.has(v))) {
    // PowerShell parameters carry their value after a colon: -LiteralPath:C:\x or -Path:"C:\x".
    const named = value.match(/^-{1,2}[\w-]+[:=](.+)$/);
    if (named) value = named[1].replace(/^["']|["']$/g, '');
    value = value.replace(/^[<>]+/, '');
    // A glob names everything under its fixed prefix, so the prefix folder is
    // tested as a folder that may hold the vault (wide), not as one file.
    const glob = value.search(/[*?[]/);
    let wide = false;
    if (glob >= 0) { value = value.slice(0, glob).replace(/[\\/][^\\/]*$/, '') || value.slice(0, glob); wide = true; }
    if (!value || value.startsWith('-') || /[$\x60]/.test(value) ||
        (/[()]/.test(value) && /["']/.test(value)) ||
        /^(?:rm|rmdir|del|erase|delete|remove|unlink|Remove-Item|node|python|python3)$/i.test(value)) continue;
    try { parts.push({ p: config.resolveTarget(c, value, cwd), wide }); } catch {}
  }
  return parts;
}
// A path touches the vault when it is inside it, or when it is a folder that
// holds the vault and the command reaches down into folders (recursive or glob).
function touchesVault(c, target, recursive) {
  return config.covers(c.vault, target.p) || ((recursive || target.wide) && config.covers(target.p, c.vault));
}
function duplicate(c, file, content) {
  const fm = vault.readFm(content) || {};
  return vault.similar(path.basename(file, path.extname(file)), vault.list(c), fm.pattern || '');
}
function backup(c, file, batch = Date.now() + '-' + require('crypto').randomBytes(4).toString('hex')) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  const relative = path.relative(c.vault, file);
  const dest = config.vaultPath(c, '.backups', config.date(c), batch, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function editEmpties(file, ti) {
  if (!fs.existsSync(file)) return false;
  const current = fs.readFileSync(file, 'utf8');
  const oldText = String(ti.old_string ?? '');
  const newText = String(ti.new_string ?? '');
  if (!oldText) return false;
  const result = ti.replace_all ? current.split(oldText).join(newText) : current.replace(oldText, () => newText);
  return result.trim() === '' && current.trim() !== '';
}
const isConfig = p => CONFIG_PATH.test(p) || (config.host.isCodex() && CODEX_CONFIG_PATH.test(p));
// Codex edits files with apply_patch: every path in the patch gets the Write/Edit rules.
// Delete or move of a vault file is a vault-delete; an Add of a new note gets the duplicate check.
function patchCall(c, input, command, levels, hits) {
  const inVault = p => Boolean(p && config.covers(c.vault, p));
  const touched = [];
  const named = [];
  for (const op of codex.patchOps(command)) {
    const from = config.resolveTarget(c, op.path, input.cwd);
    const to = op.moveTo ? config.resolveTarget(c, op.moveTo, input.cwd) : null;
    named.push(from); if (to) named.push(to);
    if (isConfig(from) || (to && isConfig(to))) levels.add('system-change');
    if (inVault(from)) touched.push(from);
    if (inVault(to)) touched.push(to);
    if (inVault(from) && (op.op === 'delete' || to)) levels.add('vault-delete');
    if (op.op === 'add' && inVault(from) && /\.md$/i.test(from)) {
      if (!fs.existsSync(from)) {
        const found = duplicate(c, from, op.content);
        if (found.length) { hits.push(...found); levels.add('new-note'); }
      } else if (!op.content.trim()) levels.add('vault-delete');
    }
  }
  return { touched: [...new Set(touched)], named };
}
function classify(input, c) {
  const tool = String(input.tool_name || '');
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const onCodex = config.host.isCodex();
  const command = onCodex && Array.isArray(ti.command) ? ti.command.join(' ') : String(ti.command || '');
  const levels = new Set();
  const shell = tool === 'Bash' || tool === 'PowerShell';
  const writing = tool === 'Write' || tool === 'Edit';
  let file = null;
  const hits = [];
  let patch = null;
  if (writing && typeof ti.file_path === 'string') {
    file = config.resolveTarget(c, ti.file_path, input.cwd);
    if (isConfig(file)) levels.add('system-change');
  }
  if (onCodex && tool === 'apply_patch') patch = patchCall(c, input, command, levels, hits);
  if (shell && !isApproveCommand(command)) {
    // On Windows the Codex shell tool is named Bash but usually runs PowerShell, so both
    // spellings of "write nowhere" count as nowhere there.
    const scan = quiet(command, onCodex || config.host.isHermes() ? 'PowerShell' : tool);
    if (SYSTEM.test(command) || setupAllows(command) || ((CONFIG_PATH.test(command) ||
        (onCodex && CODEX_CONFIG_PATH.test(command))) && SHELL_WRITE.test(scan))) {
      levels.add('system-change');
    }
    if (SHELL_MAIL.test(command)) levels.add('email-send');
    if (DESTRUCTIVE.test(O.strip(scan))) { // a one-liner whose code shows no write or delete is a read
      const recursive = RECURSIVE.test(command);
      if (commandPaths(c, command, input.cwd).some(p => touchesVault(c, p, recursive))) levels.add('vault-delete');
    }
  }
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/i);
  if (mcp) {
    const server = mcp[1].toLowerCase();
    const action = mcp[2].toLowerCase();
    const both = server + '_' + action;
    const commerce = /(?:payment|commerce|money)/.test(both) ||
      /(?:^|[_-])(?:purchase|checkout|pay|wire)(?:[_-]|$)/.test(action);
    if (commerce && /(?:^|[_-])(?:transfer|purchase|checkout|pay|wire)(?:[_-]|$)/.test(action)) {
      levels.add('money');
    }
    // Mail goes out through any connector whose name says mail, and through any
    // action that sends, replies or forwards a message or draft.
    if (/send[_-]?(?:mail|email|draft|message)|(?:mail|email|draft|message)[_-]?send/.test(both) ||
        (/(?:mail|email|outlook|gmail)/.test(both) && /(?:send|reply|forward)/.test(action))) levels.add('email-send');
    // Every mutating verb on an outside system needs approval; no server is exempt.
    // Mail and money already have their own level, so they are not double-gated.
    if (!levels.has('email-send') && !levels.has('money') && (/^(?:create|update|delete|remove|apply|publish|set|enable|disable|send|post|put|patch|archive|trash|move|rename|upload|write|reply|forward|add|insert|append|merge|close|cancel|escalate|snooze|trigger|unlist|discard|restore|link|pin)(?:[_-]|[a-z]*[A-Z]|$)/i.test(mcp[2]) ||
        /^(?:create|update|delete|remove|apply|publish|set|enable|disable|send|post|put|patch|archive|trash|move|rename|upload|write|reply|forward|add|insert|append|merge|close|cancel|escalate|snooze|trigger|unlist|discard|restore|link|pin)(?:[_-]|$)/.test(action))) {
      levels.add('vendor-write');
    }
  }
  const vaultWrite = Boolean(file && config.covers(c.vault, file));
  if (vaultWrite && /\.md$/i.test(file)) {
    if (tool === 'Write' && fs.existsSync(file) && String(ti.content ?? '').trim() === '') levels.add('vault-delete');
    if (tool === 'Edit' && editEmpties(file, ti)) levels.add('vault-delete');
    if (tool === 'Write' && !fs.existsSync(file)) {
      hits.push(...duplicate(c, file, String(ti.content ?? '')));
      if (hits.length) levels.add('new-note');
    }
  }
  return { tool, ti, command, file, vaultWrite, hits, patch, shell,
    levels: [...levels].filter(level => level === 'money' || level === 'new-note' || c.gates[level] !== false) };
}
function note(c, area, level, status, text) {
  // Logging never decides anything: a failed log line must not drop a denial or an allow.
  try { log.append(c, area, level, status, text); } catch (e) { config.logError(e); }
}
function handle(input, c) {
  const call = classify(input, c);
  const onCodex = config.host.isCodex();
  const describe = (call.patch && call.patch.named.join(', ')) || call.file || call.command || call.tool;
  if (call.patch) return patchAnswer(c, call, describe);
  if (call.levels.includes('money')) {
    note(c, 'action: ' + call.tool, 'money', 'denied', describe);
    return decision('deny', '[continuum] money: this action is never approvable. The person must do it directly.');
  }
  // Every vault Write/Edit is backed up before any answer. The hook never sees the
  // person's Yes in the prompt, so the dated copy has to exist before the question.
  const relative = call.vaultWrite ? path.relative(c.vault, call.file) : '';
  if (call.vaultWrite) {
    try { backup(c, call.file); } catch (e) {
      note(c, 'action: ' + call.tool, 'vault-write', 'denied, backup failed', relative);
      return decision('deny', '[continuum] The backup of this note failed (' + e.message + '), so the write is refused.');
    }
  }
  const tokens = approvals(c);
  const missing = call.levels.filter(level => !validToken(c, tokens[level]));
  // A shell change to vault files that will run (Claude: ask or approval; Codex: approval) is copied first.
  const guard = shellGuard(c, call, input, !onCodex || !missing.length, { commandPaths, backup, note, decision }); if (guard) return guard;
  if (missing.length) {
    // The person decides in Claude Code's own permission prompt: the hook answers
    // "ask", so the click is theirs and nothing the model writes can stand in for it.
    // A chat pre-approval (approve.js) for a level skips the prompt until it expires.
    for (const level of missing) note(c, 'action: ' + call.tool, level, onCodex ? 'denied, ask in chat' : 'asked', describe);
    const duplicates = call.hits.length ? ' Existing notes with the same title or pattern: ' +
      call.hits.slice(0, 3).map(hit => hit.name || hit.rel || String(hit)).join(', ') + '.' : '';
    if (onCodex) return codexDeny(c, missing, duplicates, describe, call.shell && copyable(c, call.command, input.cwd, commandPaths));
    return decision('ask', '[continuum] ' + missing.join(', ') + ': ' + missing.map(level => PLAIN[level]).join(' ') +
      duplicates + ' Choose Yes to let it happen this one time. Choose No and it does not happen.', missing);
  }
  for (const level of call.levels) {
    note(c, 'action: ' + call.tool, level, 'allow-by-token', describe);
  }
  if (call.vaultWrite) note(c, 'action: ' + call.tool, 'vault-write', 'allowed', relative);
  // Codex runs a call it gets no decision for; an "allow" without updatedInput is not a documented shape there.
  if (onCodex) return {};
  return call.levels.length ? decision('allow', '[continuum] Valid chat approval: ' + call.levels.join(', ')) : {};
}
// Codex has no hook permission prompt ("ask" would let the call run): deny, say how to get the yes in chat. COPY_NOTE only when true: shell-backup.js copies named notes on the approved retry, patchAnswer before any answer.
function codexDeny(c, missing, duplicates, describe, copied) {
  const hours = config.ttl(c) / 3600000;
  return decision('deny', '[continuum] Stopped, not run. ' + missing.join(', ') + ': ' +
    missing.map(level => PLAIN[level]).join(' ') + duplicates + ' Action: ' + String(describe).slice(0, 300) +
    '. Ask the person one yes or no question in chat that names this exact action. Only after they answer yes, ' +
    'run this command alone, with nothing chained to it, putting their exact words inside the double quotes: ' +
    missing.map(level => codex.approveLine(level)).join(' then ') + ' . Then retry the same call. The yes covers this kind ' +
    'of action for ' + hours + ' hour(s). If they say no or do not answer, do not run the command and do not retry.' + (copied && missing.includes('vault-delete') ? ' ' + COPY_NOTE : ''));
}
// apply_patch on Codex: back up every vault file the patch touches before any answer.
function patchAnswer(c, call, describe) {
  for (const file of call.patch.touched) {
    try { backup(c, file); } catch (e) {
      note(c, 'action: apply_patch', 'vault-write', 'denied, backup failed', path.relative(c.vault, file));
      return decision('deny', '[continuum] The backup of ' + file + ' failed (' + e.message + '), so the patch is refused.');
    }
  }
  const tokens = approvals(c);
  const missing = call.levels.filter(level => !validToken(c, tokens[level]));
  const duplicates = call.hits.length ? ' Existing notes with the same title or pattern: ' +
    call.hits.slice(0, 3).map(hit => hit.name || hit.rel || String(hit)).join(', ') + '.' : '';
  if (missing.length) {
    for (const level of missing) note(c, 'action: apply_patch', level, 'denied, ask in chat', describe);
    return codexDeny(c, missing, duplicates, describe, call.patch.touched.length > 0);
  }
  for (const level of call.levels) note(c, 'action: apply_patch', level, 'allow-by-token', describe);
  for (const file of call.patch.touched) note(c, 'action: apply_patch', 'vault-write', 'allowed', path.relative(c.vault, file));
  return {};
}
module.exports = { handle, classify, validToken, isApproveCommand, APPROVABLE };
// The gate fails closed: if it cannot decide, the call is denied with the reason.
if (require.main === module) config.hook('PreToolUse', handle, e =>
  decision('deny', '[continuum] The gate could not evaluate this call (' + String(e.message || e) + '); denied. Fix the cause or run the setup skill.'));
