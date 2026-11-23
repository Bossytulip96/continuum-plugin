# Continuum

**Continuum is for Windows 11 and for a Mac, with Node.js.** On a Mac it has been tested on one computer only: macOS 14, with an Intel chip. It has not been tested on Windows 10, on a Mac with an Apple chip, or on macOS 15 or later.

Continuum gives your AI coding app a memory made of plain Markdown notes. It also asks you before risky steps, such as deleting a note.

## What is ready today

**To get it:** download the zip from [Releases](../../releases/latest).

**On Windows 11:** before you unzip it, right-click the zip file, choose **Properties**, tick **Unblock** if you see it, and click **OK**. Then right-click the zip file again and choose **Extract All...** Without the Unblock step, some Windows 11 computers refuse to open the setup file. For Codex, the Claude desktop app and Google Antigravity, setup is one file to double-click, with no commands to type.

**On a Mac:** double-click the zip file in your Downloads folder to unzip it. On a Mac the setup file is started from the Terminal app, and the Mac guide shows every step: open Terminal, type sh and a space, drag the setup file into the window, press Return, and answer a few questions. On the test Mac, a double-click on the setup file was refused.

- **Codex in the ChatGPT app: ready on Windows and on a Mac.** After unzipping, open **Continuum Guide for Codex**, or on a Mac **Continuum Guide for Codex on a Mac**.
- **The Claude desktop app: ready on Windows and on a Mac.** After unzipping, open **Continuum Guide for Claude**, or on a Mac **Continuum Guide for Claude on a Mac**.
- **Google Antigravity (Google's app for its Gemini models): ready on Windows and on a Mac.** After unzipping, open **Continuum Guide for Antigravity**, or on a Mac **Continuum Guide for Antigravity on a Mac**. It was tested in the Antigravity app, not in the Antigravity IDE or its command line.
- **Hermes Agent: still in testing.** It installs from the terminal (INSTALL-HERMES.md) and works in the Hermes command-line chat. It has no first-time guide yet and has not passed a test in the Hermes desktop app. On a Mac it was tested on one computer, the same Intel Mac with macOS 14, with Hermes Agent 0.23.3 from the command line: the install, the check, and one question about the notes, asked twice and answered from the notes both times. Asking before a risky step was not tested in Hermes on a Mac.
- **The Gemini app and gemini.google.com: not supported.** In a test in November 2026 Continuum could not ask before a risky step there.

Tested on Windows 11, with Smart App Control on: setup, Check and Remove for Codex and for the Claude desktop app. Tested on Windows 11 with the Antigravity app 2.34.0: setup, Check and Remove for Google Antigravity. Tested on one Mac with macOS 14 (Intel), with the Claude app, the ChatGPT app and the Antigravity app 2.34.0: setup, Check and Remove for all three. Not tested yet: Windows 10, a Mac with an Apple chip, macOS 15 or later. Continuum needs Node.js; each guide shows how to get it.

## Technical details

Continuum 0.8.1 is an MIT-licensed plugin for Claude Code, with a Codex install (INSTALL-CODEX.md), a Hermes Agent install (INSTALL-HERMES.md) and a Google Antigravity install (INSTALL-ANTIGRAVITY.md), that gives each person a plain Markdown memory vault. For the Claude desktop app, Codex in the ChatGPT app and Google Antigravity there is also a guided setup that asks a few questions in plain words: on Windows a double-click install (Continuum Setup for Claude, Continuum Setup for Codex, Continuum Setup for Antigravity; guides in Continuum Guide for Claude.html, Continuum Guide for Codex.html and Continuum Guide for Antigravity.html) and, on a Mac, the same setup started from Terminal with the files that end in .command (guides in Continuum Guide for Claude on a Mac.html, Continuum Guide for Codex on a Mac.html and Continuum Guide for Antigravity on a Mac.html; tested on macOS 14, Intel). Node 20 or later is required; there are no npm dependencies.

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

Routing reads when_to_use phrases from frontmatter and ranks notes by matched phrase count, then shorter length. Each selected note is capped by maxNoteChars, never silently (see Filing). SessionStart loads the five most recent digest metadata summaries. Proposals surface when their situation words match the prompt.

The gate covers vault deletion, sending mail, outside-system MCP writes, system changes and duplicate notes. Vault Write/Edit operations preserve a dated previous version under .backups before proceeding; if the backup fails, the write is refused. Shell commands that delete, move, overwrite, truncate or run an interpreter against a vault path need the same vault-delete approval, because nothing backs those up. Money actions are always denied. Every other covered action is answered with Claude Code’s "ask" decision: Claude Code shows its own permission prompt and the person answers Yes or No there; nothing the model writes can stand in for that click. The approve command is the optional shortcut: when the person pre-approves a gate level in chat, the model records their words and that level skips the prompt until the token expires (one hour, or 24 in trusted mode). Answering a proposal does not create a gate approval. If the gate itself cannot evaluate a call (bad input, unreadable config), it denies the call and says why; the other hooks fail open.

The gate classifies tool names and visible arguments. It cannot prove the effects of arbitrary shell programs, indirect script execution or opaque connector implementations. A script path held in a shell variable is not seen, for split-note.js as for every other command. A split checks each note's bytes just before every rename, but a save from another program in that very moment cannot be detected, so close the note in other programs for the few seconds a split runs. The pre-approval shortcut trusts the model to record only words the person really said; the default prompt does not need that trust, which is why it is the default. Keep Claude Code’s own permissions on; a session that skips all permissions also skips the gate’s prompt. Backups capture prior Write/Edit content; they do not execute or reverse changes. A digest extracts the first user message and the last five from the supplied transcript; it performs no model calls.

## Filing

Nothing is trimmed to fit. When a loaded note is longer than maxNoteChars, Continuum loads it up to the last line break before the limit and adds a [continuum] notice: how much was loaded, the file holding the rest, and that the note should be split, never shortened. Status lists notes over the limit or at 80 percent of it, the nightly and weekly runs file one split proposal per such note, and session start names notes that are over. A split turns the note into a short main note with a "Subject notes" list and moves each entry word for word into a subject note; a dated copy is taken first, every line of the old note is checked to be in exactly one place, and any failure puts everything back.

- Status: node scripts/status.js (or consolidate.js --status)
- Split, dry run first (changes nothing): node scripts/split-note.js --dry-run plan.json
- Split, after the person's yes (the gate asks): node scripts/split-note.js plan.json

- After an interrupted split (status and session start say so): node scripts/split-note.js --recover

A real split holds a lock in .backups, keeps a journal and the copies in its dated .backups folder, writes every file through a temporary file and a rename, stops if another program changes one of its notes meanwhile, and proves the result exactly (each moved entry byte for byte and in order, the main note equal to the old one minus those entries plus the list) before it marks the journal finished. Run split-note.js with no plan for the plan format. The starter skill note Knowledge/Skills/Split a large note.md has the steps.

## Finding notes

A note reaches a session in three ways: its when_to_use phrases in the message (the router loads it), a link from another note, and a search across every note. The second and third are the assistant's own work, and a message with none of the phrases loads nothing. Continuum says so in three places. At session start the standing rules carry it (starter rules 10 and 11); where the loaded rules do not say it, as in every vault made before 0.6.1, or where the whole start text is longer than the host keeps (10,000 characters; on Codex the installed limit), the start text opens with a short [continuum] Finding notes block, ahead of the start page so that a host limit on start text does not cut it when the start page or the rules are long. The line above routed notes tells the assistant to read each note in full and follow its links and the other places it names (reading only) to the end of the path before answering; after a split, a main note holds only the list of its subject notes, so the links are the way in. A message of three words or more that routes no note gets one line saying that nothing was loaded and that the search is the assistant's. The answer is then the correct one, or "I could not find a definite answer" with where the assistant looked. These are instructions to the assistant, not checks: Continuum cannot prove that a link was followed.

Starter rule 12 (one direct question at a time, written in the message itself, the reasons only when asked) is a preference; like every rule there, the person can change it. An existing vault never gets new starter notes, so there the start text and the two router lines carry the finding instruction, and rule 12 is added by hand if wanted.

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

Run node test/leakscan.js, node test/smoke.js, node test/codex.js, node test/shell-backup.js, node test/codex-setup.js, node test/guided-setup.js, node test/guided-mac.js, node test/claude-setup.js, node test/filing.js, node test/split-safety.js, node test/finding.js, node test/antigravity.js, node test/antigravity-guided.js, node test/hermes.js (runs the Python adapter test when Python is found), then claude plugin validate . from the repository root. The same folder also installs as a local OpenAI Codex plugin; see INSTALL-CODEX.md. Tests use disposable temporary vaults. The smoke harness alone starts Node child processes to exercise real CLI stdin and exit behavior; runtime scripts start none. The digest reads the explicit transcript path supplied by Claude Code as a read-only exception to the configured-folder boundary; it never discovers transcript locations.

The scanner checks every path and file, including itself, for prohibited content, credential fields, disallowed extensions, 200 KB size and the file line limit. Only .git and the exact root build inputs PLAN.md, HOOK-CONTRACT.md, CODEX-PROMPT.txt, codex-stderr.txt and codex-stream.jsonl are excluded. These reviewed inputs and execution logs are not distribution files. Arbitrary new files are always scanned. Build an archive from .claude-plugin, hooks, scripts, skills, vault-skeleton, test, README.md, INSTALL-CLAUDE.md and LICENSE (for Codex also plugin.json, .codex-plugin and INSTALL-CODEX.md; for Hermes also hermes and INSTALL-HERMES.md; for Antigravity also .antigravity-plugin, hooks.json, rules and INSTALL-ANTIGRAVITY.md); do not package the build inputs or logs. For the guided setup the archive also carries, per app, the three files Continuum Setup, Continuum Check and Continuum Remove in two forms (ending in .cmd for Windows, with CRLF line endings, and in .command for a Mac, with LF line endings) and the two HTML guides (Continuum Guide for Claude.html and Continuum Guide for Claude on a Mac.html, and the same pair for Codex and for Antigravity). The guides are built by scripts/build-guide.js from GUIDE-CLAUDE.md, GUIDE-CODEX.md, GUIDE-ANTIGRAVITY.md, GUIDE-CLAUDE-MAC.md, GUIDE-CODEX-MAC.md and GUIDE-ANTIGRAVITY-MAC.md, which stay out of the archive. The Mac side of the guided setup is in scripts/lib/guided-mac.js (a typed or dragged folder name, the Desktop link) and scripts/lib/guided-mac-steps.js (the steps left after setup, in the words of each Mac app, which the Mac guides quote word for word); test/guided-mac.js checks the Mac guides, the nine .command files and the folder names on any computer.

See INSTALL-CLAUDE.md for local loading, marketplace installation, scheduling and removal.
