---
name: continuum-status
description: "Show Continuum config, note and skill counts, pending proposals, last digest and current approvals"
user-invocable: true
---

# Continuum status

Run:

```text
node "${CLAUDE_PLUGIN_ROOT}/scripts/consolidate.js" --status
```

In Codex, run `node "<plugin folder>/scripts/status.js" --host codex` instead (and `consolidate.js --host codex --status` for the counts): it prints PASS/FAIL lines for the config, the vault, the hooks file and whether Codex trusts the hooks, and changes nothing.

In Antigravity, run `node "<plugin folder>/scripts/status.js" --host antigravity` instead (and `consolidate.js --host antigravity --status` for the counts): without `--host antigravity` the scripts look for the Claude Code config and fail. `<plugin folder>` is this skill's base directory, up two levels.

Use the plugin’s installed absolute path if the root variable is unavailable in the shell. Show the actual output: config path, vault path, note count, skill count, pending proposals, last digest and approvals in force. Do not infer a working vault from a missing config. If setup is needed, direct the person to /continuum:continuum-setup. Distinguish actual output from any estimate.
