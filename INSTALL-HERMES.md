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

1. Turn the plugin on: add `continuum` under `plugins:` `enabled:` in Hermes's config.yaml (with Hermes's own config set command, or by hand; the exact command depends on your install). Skipped when it is already there.
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
- Everything here was tested against a stub of Hermes's plugin API, not a running Hermes.
