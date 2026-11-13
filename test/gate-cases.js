'use strict';
// Shell and connector forms the gate must classify. Each came from a reviewed
// bypass (the 2026-11-03 review); smoke.js runs every row through the real hook.
const path = require('path');
module.exports = function cases({ vault, root }) {
  const home = path.join(vault, 'Home.md');
  const posixHome = home.split(path.sep).join('/');
  const posixVault = vault.split(path.sep).join('/');
  const approve = 'node "' + path.join(root, 'scripts', 'approve.js') + '" vault-delete "yes, delete ' + home + ' now"';
  const setup = 'node "' + path.join(root, 'scripts', 'setup.js') + '" --person "Sample Person" --vault "' + vault + '" --machine sample --timezone UTC --autonomy ask';
  const parent = path.dirname(vault);
  const glob = path.join(parent, path.basename(vault).slice(0, 2) + '*', 'Home.md');
  return [
    // The exact approve invocation is exempt; anything chained to it or naming the script as an argument is not.
    ['Bash', { command: approve }, 'allow'],
    ['Bash', { command: approve + ' && rm "' + home + '"' }, 'vault-delete'],
    ['Bash', { command: 'node -e "1" "' + path.join(root, 'scripts', 'approve.js') + '"; rm "' + home + '"' }, 'vault-delete'],
    // Shell changes to notes without a backup: aliases, moves, truncation, git, interpreters, parameter syntax, globs, parents.
    ['PowerShell', { command: 'ri ' + home }, 'vault-delete'],
    ['Bash', { command: 'mv ' + posixHome + ' /tmp/Home.md' }, 'vault-delete'],
    ['Bash', { command: 'echo gone > ' + posixHome }, 'vault-delete'],
    ['Bash', { command: 'git -C ' + posixVault + ' clean -fd' }, 'vault-delete'],
    ['Bash', { command: 'node -e "require(\'fs\').rmSync(\'' + posixHome + '\')"' }, 'vault-delete'],
    ['Bash', { command: 'python -c "from pathlib import Path; Path(\'' + posixHome + '\').unlink()"' }, 'vault-delete'],
    ['PowerShell', { command: 'Remove-Item -LiteralPath:' + home }, 'vault-delete'],
    ['PowerShell', { command: 'Remove-Item ' + glob }, 'vault-delete'],
    ['PowerShell', { command: 'Remove-Item ' + parent + ' -Recurse' }, 'vault-delete'],
    // Reads and work outside the vault stay free.
    ['Bash', { command: 'cat "' + posixHome + '" | head' }, 'allow'],
    ['Bash', { command: 'git -C ' + posixVault + ' status' }, 'allow'],
    ['Bash', { command: 'rm /tmp/elsewhere.md' }, 'allow'],
    // A redirect to nowhere is not a write (found live 2026-11-06: a cat of the settings file with 2>/dev/null was asked about).
    ['Bash', { command: 'cat "$USERPROFILE\\.claude\\settings.json" 2>/dev/null || echo "MISSING"' }, 'allow'],
    ['Bash', { command: 'cat "' + posixHome + '" 2>/dev/null || echo MISSING' }, 'allow'],
    ['PowerShell', { command: 'Get-Content "' + home + '" 2>$null' }, 'allow'],
    ['Bash', { command: 'ls "' + posixVault + '" > /dev/null 2>&1' }, 'allow'],
    ['Bash', { command: 'echo gone 2>/dev/null > ' + posixHome }, 'vault-delete'],
    ['Bash', { command: 'echo "{}" 2>/dev/null > "$HOME/.claude/settings.json"' }, 'system-change'],
    // Setup changes Claude Code's user settings only on a yes to its allowed-folder question.
    ['Bash', { command: 'cat "' + posixHome + '" 2>"/dev/null"' }, 'allow'],
    // In Bash $null is a variable and >&1Home.md is a file; both still count as writes.
    ['Bash', { command: 'null="' + posixHome + '"; printf x >$null' }, 'vault-delete'],
    ['Bash', { command: 'cd "' + posixVault + '" && printf x >&1Home.md' }, 'vault-delete'],
    ['Bash', { command: setup + ' --allow-folder yes' }, 'system-change'],
    ['Bash', { command: setup + ' "--allow-folder" yes' }, 'system-change'],
    ['Bash', { command: setup + " --allow-folder 'YES'" }, 'system-change'],
    ['Bash', { command: setup + ' --allow-folder "$answer"' }, 'system-change'],
    ['Bash', { command: setup.replace('Sample Person', '--allow-folder no ') + ' --allow-folder yes' }, 'system-change'],
    ['Bash', { command: setup.replace(/scripts(.)setup/, 'scripts$1.$1setup') + ' --allow-folder yes' }, 'system-change'],
    ['Bash', { command: setup + ' --allow-folder no' }, 'allow'],
    ['Bash', { command: setup + ' --allow-folder "no"' }, 'allow'],
    // Mail through any connector or shell mailer; mutating verbs on every connector; reads free.
    ['mcp__gmail__send_email', {}, 'email-send'],
    ['mcp__outlook__sendMail', {}, 'email-send'],
    ['PowerShell', { command: 'Send-MailMessage -To a@example.com -From b@example.com -SmtpServer localhost' }, 'email-send'],
    ['mcp__docs__create_record', {}, 'vendor-write'],
    ['mcp__vault__delete_note', { path: 'Home.md' }, 'vendor-write'],
    ['mcp__gmail__get_message', {}, 'allow'],
    ['mcp__x__list_records', {}, 'allow'],
  ];
};
