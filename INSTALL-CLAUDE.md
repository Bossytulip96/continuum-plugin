# Install Continuum

On Windows, with the Claude desktop app, the easy way is to double-click `Continuum Setup for Claude` and follow `Continuum Guide for Claude`, with no commands to type. The rest of this page is the plugin route, for people who use the terminal.

On a Mac, with the Claude desktop app, the easy way is the same setup started from Terminal: type `sh` and a space, drag `Continuum Setup for Claude.command` into the Terminal window, press Return, and follow `Continuum Guide for Claude on a Mac`. What was seen on a Mac, and what was not tested there, is at the end of this page.

Use Node 20 or later and a terminal where node and claude are on PATH. No npm install is needed.

## Local test

From this repository root:

```text
node test/leakscan.js
node test/smoke.js
claude plugin validate .
claude --plugin-dir "<absolute plugin folder>"
```

Alternatively set CLAUDE_CODE_PLUGIN_DIRS before starting Claude Code. On Windows PowerShell:

```powershell
$env:CLAUDE_CODE_PLUGIN_DIRS = "<absolute plugin folder>"
claude
```

Multiple Windows paths use semicolons. On a POSIX shell (on a Mac, zsh in Terminal):

```sh
CLAUDE_CODE_PLUGIN_DIRS="<absolute plugin folder>" claude
```

Run /reload-plugins after editing plugin components. Start a new session after setup so SessionStart loads the new vault.

## Marketplace install

The repository includes .claude-plugin/marketplace.json pointing to its plugin root. Replace the owner/repository placeholder with the GitHub repository you were given:

```text
claude plugin marketplace add <owner/repository>
claude plugin install continuum@continuum
```

A private repository is fetched with the GitHub sign-in git already has on your machine. Claude Code never stops to ask for a password, so the first line fails when no sign-in is stored. Before you run it, accept the collaborator invitation, then do one of these two things: install the GitHub CLI and run gh auth login followed by gh auth setup-git, or add an SSH key to your GitHub account that git can use without asking for a passphrase. If the first line fails with a sign-in or SSH error, this is the cause: do one of the two and run the line again.

The same two lines work inside a Claude Code session as /plugin marketplace add and /plugin install. Installed this way the skills are namespaced, for example /continuum:continuum-setup.

Publish only the distribution paths listed in README.md; exclude the frozen build inputs and execution logs.

## First run

Run /continuum:continuum-setup. Answer these six questions in order: name to use, vault folder, machine name, timezone, autonomy, and whether setup may add the vault to Claude Code's allowed folders. The skill offers a vault folder under your home directory and your system timezone. Ask mode keeps approval windows to one hour; trusted keeps gates active with a 24-hour window. Setup runs only after all six answers. It creates config and fills a clean skeleton when the vault folder is empty. Repeating setup updates config and preserves existing notes.

Claude Code trusts only the folder it was started in. If your vault lives anywhere else, the first touch of a note in every session brings up Claude Code's own "Read outside the working directories" prompt, before any Continuum gate. The sixth setup question asks whether setup may add the vault to permissions.additionalDirectories in your user settings file (%USERPROFILE%\.claude\settings.json on Windows, ~/.claude/settings.json elsewhere). With yes, the setup script adds that one entry itself, changes nothing else in the file, and keeps a copy of the file as it was next to the Continuum config. When Continuum is already set up, that run is a system change, so you get a permission prompt and the click is yours. With no, start Claude from inside the vault folder or run claude --add-dir "<vault>". Then start a new session.

Config lives at %USERPROFILE%\.continuum\config.json on Windows, or ~/.continuum/config.json elsewhere. Set CONTINUUM_CONFIG to use another absolute config file. Each runtime path is resolved through scripts/lib/config.js.

When a gate covers a change, Claude Code shows you its permission prompt with the gate's reason; allow or deny it there. To skip the prompt for a whole gate level for a while, say so in chat ("you may delete notes for the next hour") and the model records your words with scripts/approve.js; the token expires after one hour, or 24 in trusted mode. Money actions remain denied.

## Optional scheduling

The plugin never registers a scheduled task. Run consolidation manually, or create a schedule yourself. Replace every placeholder with your actual absolute paths. These recipes use the default config; if you use an override, arrange CONTINUUM_CONFIG in the scheduler environment.

One Windows command (run in cmd; the escaped quotes preserve spaces in paths):

```bat
schtasks /Create /TN "Continuum nightly" /SC DAILY /ST 02:00 /TR "\"<absolute node executable>\" \"<absolute plugin folder>\scripts\consolidate.js\" --nightly"
```

One cron entry:

```cron
0 2 * * * "<absolute node executable>" "<absolute plugin folder>/scripts/consolidate.js" --nightly
```

Use --weekly in place of --nightly for a weekly review and set the scheduler frequency accordingly. The report rebuilds the index, lists proposals unanswered for more than seven days, counts repeated actions, proposes a missing skill after three repeats, and appends a dated Home line. Review proposals with proposal.js list; answer with yes, no or later and your own words. Approval is never inferred.

## Uninstall

For marketplace installation, run claude plugin uninstall continuum@continuum. For local loading, remove --plugin-dir or clear that folder from CLAUDE_CODE_PLUGIN_DIRS. Restart Claude Code.

Your vault and config remain yours. Back them up before removing them manually if you want a complete removal. Remove any scheduler entry you created; on Windows use schtasks /Delete /TN "Continuum nightly" and confirm, or remove your cron line. The plugin creates no scheduler entry to remove automatically.

## On a Mac: what was seen and what was not tested

The paths on this page that are given for "elsewhere" are the Mac ones: the config is `~/.continuum/config.json`, and Claude's user settings file is `~/.claude/settings.json`.

What ran on a real Mac (macOS 14 on an Intel Mac, Node.js 26 from the macOS Installer (.pkg) on nodejs.org, the Claude desktop app with a paid plan and its Code tab, 2026-11-23), from an unzipped package and with the guided setup:

- A double-click on `Continuum Setup for Claude.command` from a zip that came from the internet is refused by the Mac ("cannot be opened because it is from an unidentified developer", one button, OK). Started from Terminal (`sh`, a space, the file dragged into the window, Return) the setup ran, and no setting of the Mac was changed for it.
- Setup copied the program folder to `~/.continuum/program`, wrote the settings to `~/.continuum`, added its hook lines to Claude's own settings file and kept a copy of that file as it was (the end screen names both), suggested the notes folder `~/Continuum` (in the home folder, not in Documents) and put one item named Continuum Notes on the Desktop: a link that opens the notes folder. When the same Mac is set up for a second app with a different notes folder, Continuum Notes points at the newest one.
- In the app: Claude > Quit Claude in the bar at the top of the screen; the folder window is titled "Select folder" and ends with Cancel and Open; after Open the app asked "Trust this workspace?" (Cancel, Trust workspace). The first answer to "What are my standing rules?" listed the 12 standing rules.
- Asked to delete a note, the app showed "Allow Claude to run this command?" (Deny, Allow once) with a text that starts with `[continuum]` before anything was deleted, and a copy of the note was kept under `.backups` in the vault before the delete.
- `Continuum Check for Claude.command`, started from Terminal, said "Everything is in place." `Continuum Remove for Claude.command`, after YES, took Continuum's hook lines out of Claude's settings file; Check then named what was missing and said to run the setup file again.

Not tested on a Mac:

- A Mac with an Apple chip, and macOS 15 or later. Node.js itself asks for macOS 13.5 or later.
- The plugin route on this page (the local test, the marketplace install, the setup skill, scheduling): no Mac run of these is recorded; the Mac test used the guided setup.
