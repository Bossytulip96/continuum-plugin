# Install Continuum in Google Antigravity (Windows and Mac)

On Windows the easy way is to double-click `Continuum Setup for Antigravity` and follow `Continuum Guide for Antigravity`, with no commands to type. It installs Continuum the first way in step 2 below (a plugin for every folder), and `Continuum Remove for Antigravity` takes that folder out again. The rest of this page is the technical version.

On a Mac the easy way is the same setup started from Terminal: type `sh` and a space, drag `Continuum Setup for Antigravity.command` into the Terminal window, press Return, and follow `Continuum Guide for Antigravity on a Mac`. It also installs Continuum the first way in step 2 below. Each command on this page is given for Windows (PowerShell) and for a Mac (zsh in Terminal).

You need Node 20 or later and this plugin folder on disk. Every Antigravity hook runs one script, `scripts/antigravity-hook.js`, so the steps below only decide where Antigravity finds the hooks.

## 1. Get the folder

Put the plugin folder somewhere permanent, for example `%USERPROFILE%\continuum` (on a Mac `~/continuum`; copy it without `.git`). Antigravity reads `.antigravity-plugin\plugin.json`, `hooks.json`, `rules\AGENTS.md` and `skills\` from this folder.

## 2. Choose how the hooks load

Pick one of the three. Do not use more than one, or every hook runs twice.

- **As a plugin for every folder (the default).** Copy the folder into `%USERPROFILE%\.gemini\config\plugins\continuum` (on a Mac `~/.gemini/config/plugins/continuum`). Antigravity finds it there, lists it under Customizations, Installed, and runs its `hooks.json`, `rules\AGENTS.md` and skills in every chat, with or without a folder open. Setup then writes no hooks file.
- **As a plugin for one workspace.** Run setup first (step 3), then copy the folder into `.agents\plugins\continuum` (on a Mac `.agents/plugins/continuum`) inside the folder you open in Antigravity (your vault folder). In that order a new vault gets its starter notes: setup writes them only into an empty folder, and the plugin copy would make it non-empty. Continuum then runs only when that folder is open. Setup writes no hooks file, and the approve and check commands run from that copy.
- **As global hooks.** Leave the plugin uninstalled and let setup add a `continuum` group to `%USERPROFILE%\.gemini\config\hooks.json` (on a Mac `~/.gemini/config/hooks.json`; step 3 with `--hooks global`). The hooks then point at this exact folder, so do not move it afterwards; if you do, run setup again.

## 3. Run setup

For either plugin way:

```powershell
node "$env:USERPROFILE\continuum\scripts\setup.js" --host antigravity --person "<your name>" --vault "<absolute vault folder>" --machine "<machine label>" --timezone "America/New_York" --autonomy ask
```

On a Mac:

```sh
node ~/continuum/scripts/setup.js --host antigravity --person "<your name>" --vault "<absolute vault folder>" --machine "<machine label>" --timezone "America/New_York" --autonomy ask
```

For the global way, add `--hooks global` at the end of the same line.

It writes:

- `%USERPROFILE%\.continuum\antigravity\config.json` (on a Mac `~/.continuum/antigravity/config.json`), the Antigravity config (kept apart from the Claude Code, Codex and Hermes ones). Add `"debug": true` there to log every hook input to `hook-inputs.log` in the same folder during a test.
- The vault templates, only if the vault folder is empty.
- With `--hooks global` only: the `continuum` group in `%USERPROFILE%\.gemini\config\hooks.json` (on a Mac `~/.gemini/config/hooks.json`). Other groups in that file are kept. When the file already exists, a dated copy (`hooks.json.bak-<time>`) is kept first. A second run that would change nothing leaves the file alone.

Setup never copies or installs the plugin folder and never touches Antigravity's `config.json`.

## 4. The three steps setup prints

1. Quit Antigravity completely and open it again.
2. Open your vault folder as the workspace.
3. Ask "What are my standing rules?" If the answer quotes your vault, Continuum is working.

With the plugin for every folder, or with global hooks, step 2 can be skipped: Continuum also answers in a chat that has no folder open. Antigravity then asks for its own permission the first time that chat reads or writes a file in the vault.

On a Mac the menus are in the bar at the top of the screen: Quit is Antigravity > Quit Antigravity, and there is no Workspace menu. The vault folder is made a project with the small folder picture with a plus sign next to the word Projects in the list on the left, then New Project, Add Folder, Next. `Continuum Guide for Antigravity on a Mac` has the three steps in the Mac app's own words.

## 5. Check

```powershell
node "$env:USERPROFILE\continuum\scripts\status.js" --host antigravity
```

On a Mac:

```sh
node ~/continuum/scripts/status.js --host antigravity
```

It changes nothing and prints PASS or FAIL for: node version, config, vault and START HERE.md, the plugin manifest, and the Continuum hooks it finds (in the installed plugin folder, in `.agents\plugins\continuum` of the vault, or in the global hooks file) with their scripts. Exit code 0 means everything that could be checked passed.

## 6. Remove

```powershell
node "$env:USERPROFILE\continuum\scripts\setup.js" --host antigravity --remove
```

On a Mac:

```sh
node ~/continuum/scripts/setup.js --host antigravity --remove
```

Takes only the `continuum` group out of the global hooks file (dated copy first; a file left with nothing else in it is deleted). An installed plugin is removed in Antigravity itself. The vault and the config are left untouched.

## How it works

- Start of a chat: the start page, standing rules and recent session digests go in as one system message.
- Each message: the notes that match it go in as one system message, once per message (Antigravity calls the hook before every model call).
- Each tool call: the gate answers. A risky call brings up Antigravity's own permission prompt, set to always ask, so an earlier "Always Allow" cannot skip it. Money is always refused. A note is copied into `.backups` before it is written.
- End of a turn: the session digest in `Log/sessions/` is updated.

## Known limits

What ran on a real Antigravity (the Antigravity App 2.34.0 on Windows 11, 2026-11-22 and 2026-11-23, on two computers). All three ways were run: the global hooks way in chats that had no folder open, the one-workspace way (the folder in `.agents\plugins\continuum` of the vault, with the vault added as a project through Workspace, Create Project) on both computers, and the every-folder way (the folder copied by hand into `%USERPROFILE%\.gemini\config\plugins\continuum`) on the second computer, where Antigravity had just been installed. The App picked the hooks up each time without being restarted, and each hook ran once.

- The double-click files ran on the second computer from an unzipped package (2026-11-23). Setup copied the program folder into Antigravity's plugins folder, and after Antigravity was closed and opened again the starter rules came back as the answer to "What are my standing rules?". Check said "Everything is in place." Remove took the program folder out while Antigravity was open and left the notes and the settings. In that run the zip had not come through a browser download, so Windows had put no internet mark on it.
- In a project made from the notes folder (Workspace, Create Project, Add Folder, the Continuum Notes shortcut, Select Folder), a note was changed with no permission box from Antigravity. In a conversation with no project, Antigravity asked "Allow read access to this path?" before the first note was opened.
- With the every-folder way, Customizations, Installed listed Continuum with its five skills, its hooks and `rules\AGENTS.md`.
- The rule file loads from the plugin folder in both plugin ways: asked without opening a file, the model gave the three headings of `rules\AGENTS.md` word for word and the path it was loaded from.
- The `continuum-status` skill ran from the plugin folder and printed the check lines and the counts.
- In a chat with no folder open, Antigravity asked for its own permission before reading or writing a file in the vault ("Allow write access to this path?"), with its own "always allow" choices. Continuum's dated copy of the note and its log line were made before that question was answered.

- The start page, the standing rules and the note that matched the message reached the model, once per message, and the answer quoted them.
- Commands went through the gate and ran. A command that would delete a note was stopped for the person's answer, a dated copy of the note was made first, and both were written to the decision log.
- The permission prompt shows the `[continuum]` reason above the command. The two "always allow" choices are greyed out, so only "Yes, allow this time" and "No" can be picked. On No the command did not run and the note stayed. On Yes the command ran.
- An edit to a note and a new note, both made by Antigravity's own file tools with the vault open, went through: the edited note was copied into `.backups` first and both were written to the decision log.
- The session digest was written at the end of the turn, with the reply read from Antigravity's transcript.
- The App's tool names are not the ones in Antigravity's documentation (`read_file`, `write_file`, `edit_file`, `call_mcp_tool` and others). Continuum handles both sets.

What ran on a real Mac (the Antigravity App 2.34.0 on macOS 14 on an Intel Mac, Node.js 26 from the macOS Installer (.pkg) on nodejs.org, 2026-11-23), from an unzipped package and with the guided setup, which uses the every-folder way:

- A double-click on `Continuum Setup for Antigravity.command` from a zip that came from the internet is refused by the Mac ("cannot be opened because it is from an unidentified developer", one button, OK). Started from Terminal (`sh`, a space, the file dragged into the window, Return) the setup ran, and no setting of the Mac was changed for it.
- Setup copied the program folder to `~/.gemini/config/plugins/continuum`, wrote the settings to `~/.continuum/antigravity`, suggested the notes folder `~/Continuum` (in the home folder, not in Documents) and put one item named Continuum Notes on the Desktop: a link that opens the notes folder. When the same Mac is set up for a second app with a different notes folder, Continuum Notes points at the newest one.
- The Mac app has no Workspace menu. The project was made with the small folder picture with a plus sign next to the word Projects ("Create New Project" when the mouse rests on it), then New Project (the other choice is SSH Host...), the Create Project box (This Computer or Remote, Add Folder, Skip), Add Folder, the Continuum Notes link on the Desktop, Open, Next. The folder window opened in Downloads, where the unzipped program folder is also named Continuum; that one is the wrong folder to pick.
- After the project was made the Mac offered its command line developer tools ("The "git" command requires the command line developer tools. Would you like to install the tools now?", Cancel and Install). Continuum does not need them; Cancel is fine.
- Asked to delete a note, Antigravity showed its permission prompt ("Allow ...?", with "Yes, allow this time" and "No") with a text that starts with `[continuum]` before anything was deleted, and a copy of the note was kept under `.backups` in the vault before the delete.
- `Continuum Check for Antigravity.command`, started from Terminal, said "Everything is in place." `Continuum Remove for Antigravity.command`, after YES, took the program folder out of Antigravity's plugins folder; Check then named what was missing and said to run the setup file again.

Not tested on a Mac:

- A Mac with an Apple chip, and macOS 15 or later. Node.js itself asks for macOS 13.5 or later.
- The one-workspace way and the global hooks way, and the commands on this page typed by hand: no Mac run of these is recorded; the Mac test used the guided setup.
- The Customizations page, and Antigravity's own "Allow read access to this path?" question in a chat outside the project: neither is recorded for the Mac.

Not yet seen on the real app:

- Installing through Antigravity's own plugin install command or its Marketplace: the folder was copied by hand.
- With the one-workspace way, the Customizations page listed Continuum on one computer and not on the other. The rule file was asked for, and had loaded, on the one that listed it.
- The Antigravity IDE and the Antigravity command line: only the App was run.
- Antigravity's own Gmail, Calendar, Drive and Sheets plugins are command-line tools; the gate asks before their changing commands (`gmail mutate send` and the like), tested with sample inputs only.

Known limits:

- A turn that the person did not start (a message from another agent, a timer) keeps the text of the person's last message, so no note is loaded for it.
- A browser tool call, or a tool that matches no gate rule, is not asked about, as on the other hosts.
- Antigravity runs commands in its own way, apart from Continuum. In the test a delete that was answered Yes ran and was then refused by Windows ("Access is denied"), while the same delete from an ordinary PowerShell window worked. Continuum cannot change that.

Turn on `"debug": true` in the config for a first run on a new Antigravity version, so `hook-inputs.log` shows what Antigravity actually sends.
