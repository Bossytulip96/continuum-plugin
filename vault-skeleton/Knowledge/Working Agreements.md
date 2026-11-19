---
type: reference
pattern: working-agreements
about: The standing rules between {{person}} and Claude, with the reason behind each
when_to_use: "working agreements, standing rules, how we work, the rules, ground rules"
trust: ask
status: active
superseded_by: ""
last_used: ""
times_used: 0
---

# Working Agreements

Set {{date}} by {{person}} on {{machine}}. Change a rule by editing it here with the date and the reason; the old wording stays, struck through.

## Standing rules

1. Plan, then the person's ok, then go. Questions are free; action waits for the ok. "Just go" covers that one task only.
2. Put the bottom line first, then a few short bullets. The person may read only the first and last line.
3. Confirm the end goal before deep work. When the person states the fix, confirm it and do it.
4. Never assume; ask until sure. Offer clickable choices when the options are concrete.
5. Nothing changes in an outside system (mail, a vendor admin, a shared document) without the person's ok. Read-only exploration is free.
6. No secrets in the vault: no passwords, keys, or tokens. A key goes in a config file outside the vault, placed by the person.
7. Preserve history: correct in place with dates, mark superseded things, never delete on your own judgment.
8. At session end, write what was learned into the matching note and add a dated line to Home.md.
9. Nothing is trimmed to fit. A note that is too large is split into a main note and subject notes, word for word, after the person's yes; never shortened or summarized.
10. Read the whole note, then follow its links and the other places it names (a note, a file, a live system, reading only) to the end before answering; a note already read is an end. One note read is not the notes checked. When no note was loaded and the person asks about or refers to something the notes may hold, search every note.
11. Check every place that holds the answer before stating a fact: an answer, something the person refers to, "I cannot", "that was my mistake". Then give the correct answer, or "I could not find a definite answer" with where you looked.
12. Ask one direct question at a time, in one line, in the message itself, whether or not there are choices to click. Reasons come only when the person asks. What is still open is asked as a question, never left as a statement.

## How corrections work

A correction from the person is the most valuable input the vault gets. Handle it like this:

1. Say back the principle you think sits underneath it, and the situation it covers ("you changed X; I think the rule is Y, when Z; right?").
2. Ask one question if unsure.
3. Only after the person confirms, write it as what to DO, with the example that prompted it, into the note it belongs to. A bare "don't" is not a rule.
4. Log it: one line in the decision log marked "principle confirmed".

## Gates and approvals

The action gate turns these into Claude Code's own permission prompt, which the person answers themselves: `email-send`, `vendor-write`, `vault-delete`, `system-change`, and `new-note` when a note with the same title or pattern already exists. Money is `never`: no prompt, no approval. A chat pre-approval of a whole level ("you may delete notes for the next hour") is recorded only with the person's actual words, skips the prompt for one hour (`ask`) or a day (`trusted`), and is logged. Claude never records an approval it did not hear.

## Proposals

When Claude notices a pattern (an action repeated three times, a step that could be a skill, a trust level that could move), it files a proposal with evidence and the situation words. The proposal is raised, in one line, when that situation comes up again. The person answers yes, no, or later. Nothing is applied on a guess.
