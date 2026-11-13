---
type: reference
pattern: agents-instructions
about: How Codex works with this Continuum vault, and what to do when the hooks did not run
when_to_use: "agents, codex, continuum hooks, fallback rules"
trust: ask
status: active
superseded_by: ""
last_used: ""
times_used: 0
---
# Continuum in Codex

This folder is {{person}}'s Continuum vault: plain Markdown memory. Written by setup on {{date}}.

## When the hooks ran (local chat in this project)

- Text that starts with `[continuum]` was loaded by Continuum's hooks: the start page, standing rules, recent session digests and the notes that match the message. Use it. Do not reload those notes or repeat the bookkeeping (usage counts, index, digests); the hooks do it.
- A tool call refused with a `[continuum]` reason is the gate. Ask the person one yes or no question that names the exact action. Only after their yes, run the approve line the reason gives, alone: {{approve}}. Then retry the same call. Never run it without their words, never after a no, never for money (money is always refused).
- Session digests and the dated copies under `.backups` are written by the hooks.
- To delete, move or empty a note, run one plain command that does only that and names the note by its path: no copy of your own first, no check or log steps added. The gate copies the note into `.backups` and writes the log line itself. If it stops the command, ask one yes or no question naming the note, run the approve line alone after the yes, then the same plain command again, alone. Never ask for `system-change` to delete a note; that answer means the command was bundled, so split it.

Still your job, hooks or not:

- Decision log lines for corrections, proposal answers and skill use: `node "<plugin folder>/scripts/decision-log.js" --host codex "<area>" "<level>" "<outcome>" "<text>"`.
- When the person corrects you: say back the principle you think is underneath and the situation it covers, wait for their yes, then write it into the matching note as something to do, with the example that prompted it, and log it as "principle confirmed".
- Consolidation only when asked: `node "<plugin folder>/scripts/consolidate.js" --host codex --nightly` (or `--weekly`, `--status`).

When the hooks ran, do not do the fallback steps below by hand.

## When the hooks did not run

If there is no `[continuum]` text anywhere in this conversation, the hooks did not run (a cloud chat, or a chat outside this project). Then follow these rules yourself:

A. Recall: at the start, read `START HERE.md` and the standing rules in `Knowledge/Working Agreements.md`, and the newest files in `Log/sessions/`.
B. Route: before answering, look in `Knowledge/` for notes whose `when_to_use` phrases match the message, and read the best matches (up to three) first.
C. Gate: before you delete, move, empty or overwrite a vault note, send an email, change an outside system or change settings, ask one yes or no question naming the exact action and wait for the yes. Copy a note into `.backups/<date>/` before you change it. Never do anything with money.
D. Log: add a line to `Log/decisions-<machine>-<YYYY-MM>.md` for every gated action, correction and proposal answer.
E. Digest: at the end, write a short note in `Log/sessions/` with the first message, the last messages and what was done.
F. Consolidate: when asked, review the decision log and proposals and say what repeats; change nothing without the person's yes.
