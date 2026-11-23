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
  const split = path.join(root, 'scripts', 'split-note.js');
  const plan = path.join(parent, 'plan.json');
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
    // The Claude app's own task list (server ccd_turn) changes nothing outside the session (found live 2026-11-12:
    // five "update plan" boxes in three requests). Only those two exact tools are exempt; any other action on that server, look-alikes and other ccd_* servers are not, and mail and money keep their own levels there.
    ['mcp__ccd_turn__update_plan', {}, 'allow'],
    ['mcp__ccd_turn__wrap_up', {}, 'allow'],
    ['mcp__CCD_Turn__update_plan', {}, 'allow'],
    ['mcp__ccd_turnx__update_plan', {}, 'vendor-write'],
    ['mcp__xccd_turn__update_plan', {}, 'vendor-write'],
    ['mcp__ccd_turn__delete_everything', {}, 'vendor-write'],
    ['mcp__ccd_turn__update_ticket', {}, 'vendor-write'],
    ['mcp__ccd_turn__send_email', {}, 'email-send'],
    ['mcp__ccd_turn__pay_invoice', {}, 'money'],
    ['mcp__ccd_sidebar__delete_group', {}, 'vendor-write'],
    ['mcp__ccd_settings__set_setting', {}, 'vendor-write'],
    ['mcp__someserver__update_ticket', {}, 'vendor-write'],
    // A real split rewrites notes, so it asks like other vault rewrites; its dry run, usage and help change nothing.
    ['Bash', { command: 'node "' + split + '" "' + plan + '"' }, 'vault-delete'],
    ['PowerShell', { command: 'Get-Content plan.json | node "' + split + '" -' }, 'vault-delete'],
    ['Bash', { command: 'node "' + split + '" --dry-run "' + plan + '" && node "' + split + '" "' + plan + '"' }, 'vault-delete'],
    ['Bash', { command: 'node "' + split + '" --dry-run "' + plan + '"' }, 'allow'],
    ['Bash', { command: 'node "' + split + '" "' + plan + '" --dry-run' }, 'allow'],
    ['Bash', { command: 'node "' + split + '"' }, 'allow'],
    ['Bash', { command: 'node "' + split + '" --help' }, 'allow'],
    // A dry run is the argument --dry-run of the same command: not a comment, not part of another word, not another command.
    ['Bash', { command: 'node "' + split + '" "' + plan + '" # --dry-run' }, 'vault-delete'],
    ['Bash', { command: 'node "' + split + '" "' + plan + '" "note --dry-run"' }, 'vault-delete'],
    ['Bash', { command: 'echo --dry-run; node "' + split + '" "' + plan + '"' }, 'vault-delete'],
    ['Bash', { command: 'node "' + split + '" "' + plan + '" && echo --dry-run' }, 'vault-delete'],
    ['PowerShell', { command: 'node "' + split + '" "' + plan + '" | Select-String --dry-run' }, 'vault-delete'],
    ['Bash', { command: 'node scripts/split-note.js "' + plan + '"' }, 'vault-delete'],
    ['Bash', { command: 'node "' + split + '" --recover' }, 'vault-delete'],
    ['PowerShell', { command: 'node .\\scripts\\split-note.js "' + plan + '" --dry-run' }, 'allow'],
    ['PowerShell', { command: 'node .\\scripts\\split-note.js "' + plan + '"' }, 'vault-delete'],
    // A real split wrapped in another shell is still a real split; a dry run written across a line continuation is still a dry run.
    ['Bash', { command: 'bash -c "node \'' + split + '\' \'' + plan + '\'"' }, 'vault-delete'],
    ['PowerShell', { command: 'cmd /c node "' + split + '" "' + plan + '"' }, 'vault-delete'],
    ['PowerShell', { command: 'powershell -Command "node \'' + split + '\' \'' + plan + '\'"' }, 'vault-delete'],
    ['Bash', { command: 'bash -c "node \'' + split + '\' --dry-run \'' + plan + '\'"' }, 'allow'],
    ['Bash', { command: 'node "' + split + '" \\\n  --dry-run "' + plan + '"' }, 'allow'],
    ['PowerShell', { command: 'node "' + split + '" `\r\n  --dry-run "' + plan + '"' }, 'allow'],
    ['PowerShell', { command: 'cmd /c node "' + split + '" ^\r\n  --dry-run "' + plan + '"' }, 'allow'],
    ['Bash', { command: 'node "' + split + '" "' + plan + '"\n--dry-run' }, 'vault-delete'],
    ['Bash', { command: 'node scripts/split-note.js --host codex --dry-run "' + plan + '"' }, 'allow'],
    ['Bash', { command: 'node "' + split + '" "--dry-run" "' + plan + '"' }, 'allow'],
    // The Mac and Linux ways to change or remove a note, and to change the computer (added with the Mac, 2026-11-23).
    ['Bash', { command: 'trash ' + posixHome }, 'vault-delete'],
    ['Bash', { command: "sed -i '' 's/a/b/' " + posixHome }, 'vault-delete'],
    ['Bash', { command: 'perl -pi -e "s/a/b/" ' + posixHome }, 'vault-delete'],
    ['Bash', { command: 'ditto /tmp/other.md ' + posixHome }, 'vault-delete'],
    ['Bash', { command: 'sed -n 1,5p ' + posixHome }, 'allow'],
    ['Bash', { command: 'defaults read com.sample.app' }, 'allow'],
    ['Bash', { command: 'defaults write com.sample.app key -bool true' }, 'system-change'],
    ['Bash', { command: 'launchctl load /tmp/sample.plist' }, 'system-change'],
    ['Bash', { command: 'sudo softwareupdate --list' }, 'system-change'],
    ['Bash', { command: 'osascript -e "tell application \\"Finder\\" to empty trash"' }, 'system-change'],
    // zsh and sh write a space in a name as backslash-space; a Mac's disk does not tell Home.md from HOME.MD.
    ...(process.platform === 'win32' ? [] : [['Bash', { command: 'rm ' + posixVault + '/Knowledge/Working\\ Agreements.md' }, 'vault-delete']]),
    // (Only where the disk really does that: a Mac disk can also be set to tell them apart.)
    ...(process.platform === 'darwin' && require('fs').existsSync(posixHome.toUpperCase()) ? [['Bash', { command: 'rm "' + posixHome.toUpperCase() + '"' }, 'vault-delete']] : []),
  ];
};
