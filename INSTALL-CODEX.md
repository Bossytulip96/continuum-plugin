# Install Continuum in OpenAI Codex (Windows and Mac)

On Windows the easy way is to double-click `Continuum Setup for Codex` and follow `Continuum Guide for Codex`, with no commands to type. On a Mac the easy way is the same setup started from Terminal: type `sh` and a space, drag `Continuum Setup for Codex.command` into the Terminal window, press Return, and follow `Continuum Guide for Codex on a Mac`. The rest of this page is the technical version; each command is given for Windows (PowerShell) and for a Mac (zsh in Terminal).

One command sets everything up. You need Node 20 or later and this plugin folder on disk.

## 1. Get the folder

Put the plugin folder somewhere permanent, for example `%USERPROFILE%\.codex\plugins\continuum` (on a Mac `~/.codex/plugins/continuum`; copy it without `.git`). The hooks will point at this exact folder, so do not move it afterwards; if you do, run setup again.

## 2. Optional: the skills in Codex

Codex can load the plugin's skills (setup, status and the rest) through a personal marketplace. Create `%USERPROFILE%\.agents\plugins\marketplace.json` (on a Mac `~/.agents/plugins/marketplace.json`); `source.path` is resolved from your home folder:

```json
{
  "name": "personal",
  "interface": { "displayName": "Personal" },
  "plugins": [
    {
      "name": "continuum",
      "source": { "source": "local", "path": "./.codex/plugins/continuum" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

Restart the Codex app and install Continuum from the "Personal" source (or `codex plugin marketplace add` with that folder). The plugin key in `config.toml` is `plugins."continuum@personal"`. This step is only for the skills: Codex does not load a plugin's hooks (checked with CLI 0.161 and app 26.1103), which is why setup writes them into the vault.

## 3. Run setup (the one step)

```powershell
node "$env:USERPROFILE\.codex\plugins\continuum\scripts\setup.js" --host codex --person "<your name>" --vault "<absolute vault folder>" --machine "<machine label>" --timezone "America/New_York" --autonomy ask --allow-folder no
```

On a Mac:

```sh
node ~/.codex/plugins/continuum/scripts/setup.js --host codex --person "<your name>" --vault "<absolute vault folder>" --machine "<machine label>" --timezone "America/New_York" --autonomy ask --allow-folder no
```

It writes:

- `%USERPROFILE%\.continuum\codex\config.json` (on a Mac `~/.continuum/codex/config.json`), the Codex config (kept apart from the Claude Code one). Add `"debug": true` there to log every hook input to `hook-inputs.log` in the same folder during a test.
- The vault templates, only if the vault folder is empty.
- `<vault>\.codex\hooks.json` (on a Mac `<vault>/.codex/hooks.json`): the six Continuum hooks with this plugin folder's absolute path. A second run that would change nothing leaves the file alone, so your Trust is kept. If the file already holds other hooks, setup keeps a dated copy (`hooks.json.bak-<time>`), keeps those hooks and replaces only Continuum's.
- `<vault>\AGENTS.md` (on a Mac `<vault>/AGENTS.md`), only if there is none: how Codex should use what the hooks load, and fallback rules for chats where no hook ran.

`--hooks user` writes `%CODEX_HOME%\hooks.json` (default `%USERPROFILE%\.codex\hooks.json`; on a Mac `$CODEX_HOME/hooks.json`, default `~/.codex/hooks.json`) instead, so the hooks run in every local Codex chat on the computer. `--hooks none` writes no hooks file.

## 4. The five steps setup prints

1. Quit the Codex app completely (File > Quit) and open it again.
2. File > Open Folder, and choose your vault folder.
3. Settings > Hooks, find your vault folder, and click Trust all.
4. At the message box, pick "On your computer" (the cloud or computer icon at the right end). Codex remembers it.
5. Ask "What are my standing rules?" If the answer quotes your vault, Continuum is working.

Codex records trust per hook definition. Changing the plugin's scripts does not need a new Trust; a changed hooks file does (setup says so when it changes one). `codex exec -C "<vault>"` also runs the hooks.

On a Mac the menus are in the bar at the top of the screen, and the ChatGPT app names these places differently: Quit is ChatGPT > Quit ChatGPT, the folder is opened with File > Open Folder... (the app then asks "Trust this folder?"), Settings is ChatGPT > Settings..., and above the message box it says "This computer". `Continuum Guide for Codex on a Mac` has the six steps in the Mac app's own words.

## 5. Check

```powershell
node "$env:USERPROFILE\.codex\plugins\continuum\scripts\status.js" --host codex
```

On a Mac:

```sh
node ~/.codex/plugins/continuum/scripts/status.js --host codex
```

It changes nothing and prints PASS or FAIL for: node version, config, vault and START HERE.md, the hooks file and its scripts, and whether Codex trusts the hooks (read from `config.toml`; "cannot tell" when that file cannot be read). Exit code 0 means everything that could be checked passed.

## 6. Remove

```powershell
node "$env:USERPROFILE\.codex\plugins\continuum\scripts\setup.js" --host codex --remove
```

On a Mac:

```sh
node ~/.codex/plugins/continuum/scripts/setup.js --host codex --remove
```

Takes Continuum's entries out of the vault's and the user's hooks file (dated copy first; a file left with nothing else in it is deleted). The vault and the config are left untouched.

## Known limits

- A cloud chat runs no local hooks. Then nothing is loaded, gated or written; AGENTS.md asks Codex to follow the same rules by itself.
- Plugin hooks do not load in Codex as of CLI 0.161 / app 26.1103; `hooks/codex-hooks.json` in the plugin is only the template setup copies.
- The hooks apply to the vault project only, unless you use `--hooks user`.
- Codex cannot show a permission prompt from a hook: where Claude Code would ask, the gate refuses the call and Codex asks you in chat; after your yes it runs the approve line and retries. Money is always refused.

## On a Mac: what was seen and what was not tested

What ran on a real Mac (macOS 14 on an Intel Mac, Node.js 26 from the macOS Installer (.pkg) on nodejs.org, the ChatGPT app with Codex, 2026-11-23), from an unzipped package and with the guided setup:

- A double-click on `Continuum Setup for Codex.command` from a zip that came from the internet is refused by the Mac ("cannot be opened because it is from an unidentified developer", one button, OK). Started from Terminal (`sh`, a space, the file dragged into the window, Return) the setup ran, and no setting of the Mac was changed for it.
- Setup copied the program folder to `~/.codex/plugins/continuum`, wrote the settings to `~/.continuum/codex`, suggested the notes folder `~/Continuum` (in the home folder, not in Documents) and put one item named Continuum Notes on the Desktop: a link that opens the notes folder. When the same Mac is set up for a second app with a different notes folder, Continuum Notes points at the newest one.
- In the app: File > Open Folder..., then "Trust this folder?" (Trust folder, Cancel); ChatGPT > Settings..., the search box, "hooks", Hooks; the row of the notes folder showed "6 hooks" and "6 need review"; after Trust all every switch was on; "This computer" and the name of the notes folder were above the message box.
- Asked to make a note, Codex wrote it with a shell command; the gate stopped that command, Codex asked in the chat, and after a yes it recorded the approval and the note was made. A delete asked for right after went through on that same approval, and a copy of the note was kept under `.backups` in the vault before the delete.
- `Continuum Check for Codex.command`, started from Terminal, said "Everything is in place." `Continuum Remove for Codex.command`, after YES, took Continuum's entries out of the Codex hooks file; Check then named what was missing and said to run the setup file again.

Not tested on a Mac:

- A Mac with an Apple chip, and macOS 15 or later. Node.js itself asks for macOS 13.5 or later.
- The commands on this page typed by hand (steps 3, 5 and 6), the skills through a personal marketplace (step 2), `--hooks user` and `codex exec`: no Mac run of these is recorded; the Mac test used the guided setup.
