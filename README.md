# Continuum

Continuum gives your AI coding app a memory made of plain Markdown notes. It also asks you before risky steps, such as deleting a note.

## What is ready today

- **Codex in the ChatGPT app, on Windows: ready.** Download the zip from [Releases](../../releases/latest), unzip it, and open **Continuum Guide for Codex**. Setup is one file to double-click, with no commands to type.
- **Claude Code: still in testing.** It installs through the terminal steps in INSTALL-CLAUDE.md. A double-click setup is being built.
- **Hermes Agent: still in testing.** It installs through the steps in INSTALL-HERMES.md.

## Technical details

Continuum 0.4.3 is an MIT-licensed plugin for Claude Code, with a Codex install (INSTALL-CODEX.md) and a Hermes Agent install (INSTALL-HERMES.md), that gives each person a plain Markdown memory vault. Node 20 or later is required; there are no npm dependencies.

## How it works in 10 lines

1. Install the plugin folder and run /continuum:continuum-setup.
2. Answer six questions to create your own config and clean vault; the sixth lets setup add the vault to the folders Claude Code reads without asking.
3. SessionStart loads START HERE, standing rules and recent digest summaries.
4. Prompt routing matches whole words in note frontmatter phrases.
5. Relevant notes are injected and their usage fields are updated.
6. The action gate turns covered actions into Claude Code's own permission prompt, so the click is yours.
7. A chat pre-approval of a gate level skips that prompt for one hour, or 24 hours in trusted mode.
8. Decisions, proposals and corrections remain readable Markdown records.
9. A digest of your messages, without tool outputs, is written as you go.
10. Run consolidation manually or schedule it yourself to review recurring work.

## The five hook functions

There are five registered events and five functions. SessionStart injects starting context and builds the index; UserPromptSubmit routes notes; correction capture inside that same router records candidate learning; PreToolUse gates actions and backs up vault writes; the session digest is updated when a message is submitted, when a turn ends (Stop) and when the session ends (SessionEnd, which closes it). Claude Code does not run Stop for a turn the person interrupts, which is why a submitted message updates the digest too. Every hook returns JSON and exits zero on errors. Missing config points to /continuum:continuum-setup on stderr.

Routing reads when_to_use phrases from frontmatter and ranks notes by matched phrase count, then shorter length. Each selected note is capped by maxNoteChars. SessionStart loads the five most recent digest metadata summaries. Proposals surface when their situation words match the prompt.

The gate covers vault deletion, sending mail, outside-system MCP writes, system changes and duplicate notes. Vault Write/Edit operations preserve a dated previous version under .backups before proceeding; if the backup fails, the write is refused. Shell commands that delete, move, overwrite, truncate or run an interpreter against a vault path need the same vault-delete approval, because nothing backs those up. Money actions are always denied. Every other covered action is answered with Claude Code’s "ask" decision: Claude Code shows its own permission prompt and the person answers Yes or No there; nothing the model writes can stand in for that click. The approve command is the optional shortcut: when the person pre-approves a gate level in chat, the model records their words and that level skips the prompt until the token expires (one hour, or 24 in trusted mode). Answering a proposal does not create a gate approval. If the gate itself cannot evaluate a call (bad input, unreadable config), it denies the call and says why; the other hooks fail open.

The gate classifies tool names and visible arguments. It cannot prove the effects of arbitrary shell programs, indirect script execution or opaque connector implementations. The pre-approval shortcut trusts the model to record only words the person really said; the default prompt does not need that trust, which is why it is the default. Keep Claude Code’s own permissions on; a session that skips all permissions also skips the gate’s prompt. Backups capture prior Write/Edit content; they do not execute or reverse changes. A digest extracts the first user message and the last five from the supplied transcript; it performs no model calls.

## Skills

| Command | Purpose |
| --- | --- |
| /continuum:continuum-setup | Six questions, then create config and vault |
| /continuum:continuum-status | Show paths, counts, pending proposals, digest and current approvals |
| /continuum:mirror-the-day | Explain completed work with dated receipts |
| /continuum:scout-a-tool | Evaluate a tool and write an evidence ledger row |
| /continuum:route-a-task | Assign concrete steps with acceptance checks |

## Config

All scripts load config through scripts/lib/config.js. The default is %USERPROFILE%\.continuum\config.json on Windows or ~/.continuum/config.json elsewhere; CONTINUUM_CONFIG selects another file. Setup collects person, absolute vault path, machine label, timezone and autonomy (ask or trusted). Version is 1. All gates must stay on; money is never approvable. Inject defaults: startPage = START HERE.md, maxNoteChars = 25000, maxNotesPerPrompt = 3. Digests default to true; quietHours defaults to null and is reserved, with no scheduler behavior.

Do not put secrets in notes or config. The config directory also holds approvals.json and hooks.log. Machine labels identify per-machine decision and digest records. Setup fills template placeholders and never overwrites a nonempty vault. Markdown uses type, pattern, about, when_to_use, trust, status, superseded_by, last_used and times_used; skills also use requires.

## Local checks and distribution

Run node test/leakscan.js, node test/smoke.js, node test/codex.js, node test/shell-backup.js, node test/codex-setup.js, node test/guided-setup.js, node test/hermes.js (runs the Python adapter test when Python is found), then claude plugin validate . from the repository root. The same folder also installs as a local OpenAI Codex plugin; see INSTALL-CODEX.md. Tests use disposable temporary vaults. The smoke harness alone starts Node child processes to exercise real CLI stdin and exit behavior; runtime scripts start none. The digest reads the explicit transcript path supplied by Claude Code as a read-only exception to the configured-folder boundary; it never discovers transcript locations.

The scanner checks every path and file, including itself, for prohibited content, credential fields, disallowed extensions, 200 KB size and the file line limit. Only .git and the exact root build inputs PLAN.md, HOOK-CONTRACT.md, CODEX-PROMPT.txt, codex-stderr.txt and codex-stream.jsonl are excluded. These reviewed inputs and execution logs are not distribution files. Arbitrary new files are always scanned. Build an archive from .claude-plugin, hooks, scripts, skills, vault-skeleton, test, README.md, INSTALL-CLAUDE.md and LICENSE (for Codex also plugin.json, .codex-plugin and INSTALL-CODEX.md; for Hermes also hermes and INSTALL-HERMES.md); do not package the build inputs or logs.

See INSTALL-CLAUDE.md for local loading, marketplace installation, scheduling and removal.
