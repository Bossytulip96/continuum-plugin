# Continuum in Antigravity

Continuum is plain Markdown memory: a notes folder (the vault) with a start page, standing rules, notes and session digests. This rule is loaded in every chat while the Continuum plugin is enabled.

## When the hooks ran

- Text that starts with `[continuum]` was loaded by Continuum's hooks: the start page, standing rules, recent session digests and the notes that match the message. Use it: read each loaded note in full, then follow its links and the other places it names (reading only) to the end of the path before answering. A message that loaded no note means the search is yours: when it asks about or refers to something the notes may hold, search every note. Do not reload a note that was loaded whole, and do not repeat the bookkeeping (usage counts, index, digests); the hooks do it.
- Some tool calls bring up Antigravity's permission prompt with a reason that starts with `[continuum]`. That is the gate: the person answers it, not you. A call refused with a `[continuum]` reason stays refused; never try another way to the same result. Money is always refused.
- When the person says in chat that a whole kind of gated action may go ahead for a while, run the approve line from the `[continuum] Chat approval` text, alone, with their exact words. Never run it without their words, never after a no, never for money.
- Session digests and the dated copies under `.backups` are written by the hooks.
- To delete, move or empty a note, run one plain command that does only that and names the note by its path: no copy of your own first, no check or log steps added. The gate copies the note into `.backups` and writes the log line itself.

Still your job, hooks or not:

- Decision log lines for corrections, proposal answers and skill use: `node "<plugin folder>/scripts/decision-log.js" --host antigravity "<area>" "<level>" "<outcome>" "<text>"`.
- When the person corrects you: say back the principle you think is underneath and the situation it covers, wait for their yes, then write it into the matching note as something to do, with the example that prompted it, and log it as "principle confirmed".
- Finding: check every place that holds the answer before stating a fact. The reply is the correct answer, or "I could not find a definite answer" with where you looked.
- Filing: nothing is trimmed to fit. A note that is too large is split into a main note and subject notes, word for word, with `node "<plugin folder>/scripts/split-note.js" --host antigravity --dry-run <plan.json>` first and the real run only after the person's yes; never shorten or summarize a note.

`<plugin folder>` is the folder this rule came from; the `[continuum] Chat approval` text names it in full. When the hooks ran, do not do the fallback steps below by hand.

## When the hooks did not run

If there is no `[continuum]` text anywhere in this conversation, the hooks did not run (Continuum is not set up yet, or its hooks are off). Then say so in one line, and follow these rules yourself if the person points you at their notes folder:

A. Recall: at the start, read `START HERE.md` and the standing rules in `Knowledge/Working Agreements.md`, and the newest files in `Log/sessions/`.
B. Route: before answering, look in `Knowledge/` for notes whose `when_to_use` phrases match the message, and read the best matches (up to three) in full. Follow their links and the other places they name (reading only) to the end. When nothing matches and the message asks about or refers to something the notes may hold, search every note. Then give the correct answer, or "I could not find a definite answer" with where you looked.
C. Gate: before you delete, move, empty or overwrite a vault note, send an email, change an outside system or change settings, ask one yes or no question naming the exact action and wait for the yes. Copy a note into `.backups/<date>/` before you change it. Never do anything with money.
D. Log: add a line to `Log/decisions-<machine>-<YYYY-MM>.md` for every gated action, correction and proposal answer.
E. Digest: at the end, write a short note in `Log/sessions/` with the first message, the last messages and what was done.
F. Filing: read a note whole, never shorten or summarize it to make it fit; a note that is too large is split into a main note and subject notes, word for word, after the person's yes.
