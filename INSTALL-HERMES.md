# Install Continuum in Hermes Agent

The same package runs under Hermes. Hermes loads a small Python adapter (`hermes/` in this package) that hands every Hermes event to the package's Node scripts with `--host hermes` and maps the answer back; all rules live in the Node scripts. You need Node 20 or later; the adapter uses only Python's standard library (Python 3.11 or later, which Hermes already has).

## One step

```powershell
node "<package folder>\scripts\setup.js" --host hermes --hermes-home "<Hermes home folder>" --person "<your name>" --vault "<absolute vault folder>" --machine "<machine label>" --timezone "America/New_York" --autonomy ask --allow-folder no --digests summary
```

Options: `--node "<path to node.exe>"` (default: the node that runs setup), `--digests full` to load the full text of the five newest session digests at the start instead of one line each.

It writes:

- `%USERPROFILE%\.continuum\hermes\config.json`, the Hermes config (apart from the Claude Code and Codex ones).
- The vault templates, only if the vault folder is empty.
- `<Hermes home>\plugins\continuum\` (plugin.yaml, `__init__.py`) and `continuum.json` next to them, which tells the adapter where the package, node and the config are. An adapter already there is first moved to `<Hermes home>\backups\plugins\continuum-<time>\`.

It does not edit Hermes's `config.yaml`. It prints the steps left:

1. Turn the plugin on: `hermes plugins enable continuum`. On Hermes Agent 0.23.1 the running gateway picks the plugin up at once and says so. If that command is missing or fails on your install, add `continuum` under `plugins:` `enabled:` in Hermes's config.yaml by hand. Skipped when it is already there.
2. With `--digests full`: raise `hooks.output_spill.max_chars` to at least 100000, or Hermes cuts the start context.
3. Restart the Hermes gateway and the dashboard.
4. Ask "What are my standing rules?" If the answer quotes your vault, Continuum is working.

## Check

```powershell
node "<package folder>\scripts\status.js" --host hermes --hermes-home "<Hermes home folder>"
```

Read-only. PASS or FAIL for node, the config, the vault and START HERE.md, the adapter, its sidecar and scripts, the adapter version against the package version, and whether continuum is enabled in config.yaml ("cannot tell" when the file cannot be read); an INFO line gives the spill limit.

## Remove

```powershell
node "<package folder>\scripts\setup.js" --host hermes --hermes-home "<Hermes home folder>" --remove
```

Moves the adapter to `<Hermes home>\backups\plugins\continuum-<time>\`. The vault and the config are left untouched. Restart the gateway.

## Where Hermes finds the notes

Hermes does not work from inside your notes folder, so Continuum names the folder for it: once in the start text and once after each message's loaded-note or search text. On a computer with more than one Continuum notes folder (one for Claude, one for Codex, one for Hermes), this is what keeps Hermes in its own.

## How the gate looks in Hermes

| Hermes tool | Gate sees | Result |
| --- | --- | --- |
| `terminal` | `Bash` with the command | shell rules (PowerShell and sh) |
| `write_file` | `Write` with path and content | dated copy of a vault note; emptying a note or a duplicate new note asks |
| `patch` | `Edit` (old/new text under common field names), otherwise `Write` with unknown content | dated copy; allowed |
| anything else | its own name | only `mcp__<server>__<action>` names are classified |

Gate answers: ask becomes Hermes's own Yes/No approval card (`rule_key` `continuum:<level>`), deny becomes a block, allow passes. The dated copy is made before the card is shown. A yes given ahead of time in chat is recorded with `node "<package folder>\scripts\approve.js" --host hermes <level> "<words>"`. Money is always refused.

## Limits

- Tools other than `terminal`, `write_file` and `patch` are not classified unless they are named `mcp__<server>__<action>`; the mail, outside-system and money gates depend on tool names Hermes may not use.
- The exact `patch` argument shape is not known; an unknown shape is copied and allowed, never asked.
- The install, the check and step 1 were run on a real Hermes Agent (0.23.1 and 0.23.2, Windows, 2026-11-18), and so were the loading hooks: in `hermes chat` the start page and the rules note were loaded, the twelve rules came back, and a session record was written to Log/sessions when the chat ended. The gate ran there too: a delete and a real split of a large note each brought Hermes's approval card with the reason that starts with [continuum]; Deny stopped the command, and Allow once let it run with a copy kept first. A linked note, a search with no lookup word and the split itself gave the right answers.
- If the Hermes desktop app answers "Session unavailable" to every message, run `hermes status`. When Model reads "(not set)", pick a model first with `hermes model`. In the test of 2026-11-18 the app kept showing the notice with the plugin switched off and with a model set, while `hermes chat` in a terminal worked on the same computer. The cause of the notice is not known.
