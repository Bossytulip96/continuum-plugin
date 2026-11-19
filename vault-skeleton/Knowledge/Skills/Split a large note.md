---
type: skill
pattern: split-large-note
about: Turn a note that has grown too large into a short main note with subject notes, moved word for word
when_to_use: "note too large, note too long, split a note, large note, subject notes, main note, memory too large, note size"
trust: ask
status: active
superseded_by: ""
last_used: ""
times_used: 0
requires: "The whole note read first, the person's yes to the grouping and to the real split"
---

# Split a large note

Never shorten, summarize or reword while splitting. Every entry moves exactly as it is written. If an entry fits no subject, ask the person.

1. When it applies: a `[continuum]` notice says a note was loaded only in part or is too large, the status check lists a note over or close to the limit, or a `split` proposal comes up.
2. Read the WHOLE note first, from the file, not from what was loaded.
3. Group its entries by subject. Tell the person in plain words which subject notes you propose, which entries go to each, and what stays in the main note. Wait for their yes.
4. Write the plan file: the source note, and for each subject note its title, `about`, `when_to_use` (the words the person would say about that subject) and the blocks that move there. A block is the exact first line of a `##` or `###` section or of a top-level `- ` entry.
5. Run the dry run: `node "<plugin folder>/scripts/split-note.js" --dry-run <plan.json>`. It changes nothing. Show the person its numbers. Fix any block it could not find.
6. Only after the person's yes, ask them to close the note in other programs for the few seconds a split runs (a save from another program in that moment cannot be detected), then run the same command without `--dry-run` and answer the permission box. Read back its result line: every line of the old note found exactly once.
7. Ask the person for three or four sample questions and check that each one opens the right subject note. If one does not, adjust that note's `when_to_use` with them.
8. If a `[continuum]` line says a split did not finish, run the same command with only `--recover` before anything else and tell the person what it put back.
9. From now on, a new entry goes into the note for its subject, not into the main note.
10. The main note now ends with a list of its subject notes. When the main note is loaded for a question, open the subject note the question belongs to before answering: the main note no longer holds those entries.
