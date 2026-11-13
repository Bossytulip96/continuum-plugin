'use strict';
// Interpreter one-liners (python -c, node -e, pwsh -Command ...): agents run them constantly to read
// things. One counts as destructive only when its inline code shows a write or delete. A one-liner whose
// code is not one quoted argument is left alone, so the gate treats it as it always did.
const ONE = /\b(python3?|py|node|perl|ruby|pwsh|powershell)(?:\.exe)?\s+(-c|-e|-Command)\s+("((?:\\.|[^"\\])*)"|'((?:''|[^'])*)')/gi;
const WRITES = new RegExp([
  "open\\s*\\([^)]*?,\\s*(?:mode\\s*=\\s*)?['\"][^'\"]*[wax+]", '\\.write\\s*\\(', 'write_text', 'write_bytes', 'writelines',
  'writeFile', 'appendFile', 'createWriteStream', 'unlink', '\\bremove\\b', 'rmtree', 'rmdir', 'rmSync', '\\brenames?\\b',
  '\\bos\\.replace\\s*\\(', '\\)\\.replace\\s*\\(', 'shutil\\.',
  '\\bos\\.(?:remove|unlink|rename|replace|rmdir|removedirs|makedirs|mkdir|truncate|chmod|system)',
  '\\bfs\\.(?:rm|unlink|rename|write|append|copyFile|cp|mkdir|truncate)', 'subprocess', 'child_process',
  '\\bexec\\s*\\(', '\\beval\\s*\\(', 'Invoke-Expression', '\\biex\\b',
  'Set-Content', 'Add-Content', 'Out-File', 'Remove-Item', 'Move-Item', 'Copy-Item', 'Clear-Content', 'New-Item', 'Rename-Item'
].join('|'), 'i');
function find(command) {
  const out = [];
  let m;
  ONE.lastIndex = 0;
  while ((m = ONE.exec(String(command)))) {
    const code = m[4] !== undefined ? m[4] : m[5];
    const shell = /^(?:pwsh|powershell)$/i.test(m[1]);
    out.push({ start: m.index, end: m.index + m[0].length, code, shell, writes: WRITES.test(code) || (shell && />/.test(code)) });
  }
  return out;
}
// The command with every harmless one-liner taken out; what is left is tested as before.
function strip(command) {
  let text = String(command);
  for (const o of find(text).reverse()) if (!o.writes) text = text.slice(0, o.start) + ' ' + text.slice(o.end);
  return text;
}
// The code strings themselves are never paths; the quoted strings inside them that look like paths are.
const codes = command => new Set(find(command).map(o => o.code));
function inner(command) {
  const found = [];
  for (const o of find(command)) {
    const rx = /"([^"]+)"|'([^']+)'/g;
    let m;
    while ((m = rx.exec(o.code))) { const v = m[1] ?? m[2]; if (/[\\/.]/.test(v)) found.push(v); }
    // PowerShell code names paths bare as well (Remove-Item Knowledge/x.md).
    if (o.shell) for (const t of o.code.split(/[\s;|&(){}]+/)) if (/[\\/.]/.test(t) && !/["'$`]/.test(t)) found.push(t);
  }
  return found;
}
module.exports = { find, strip, codes, inner, WRITES };
