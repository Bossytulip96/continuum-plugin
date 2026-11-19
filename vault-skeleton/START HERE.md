---
type: reference
pattern: start
about: The starting point for {{person}}'s vault; read every session
when_to_use: ""
trust: ask
status: active
superseded_by: ""
last_used: ""
times_used: 0
---

# START HERE

This vault is {{person}}'s working memory for Claude Code. It is plain Markdown: anyone can open it, read it, and correct it. Claude reads this page at the start of every session. The current machine is {{machine}}.

## How the vault works

- **Notes carry frontmatter.** Every note starts with a block of fields. The one that matters most is `when_to_use`: a comma-separated list of words and phrases. When a message to Claude contains one of those phrases, the note is loaded into that session automatically. No index to maintain by hand: write the note, give it the phrases, done. A message with none of the phrases loads nothing; Claude then searches the notes itself.
- **Knowledge/** holds what is true about the person's world, one note per topic. **Knowledge/Skills/** holds how to do things, one note per repeatable task, each with a `trust` level (`ask`, `confirm`, or `auto`). **Log/** holds what happened: decisions, session digests, proposals. **Reference/** holds source material. **notes-and-ideas/** holds things not yet filed.
- **Gates.** Some actions stop at a permission prompt the person answers themselves: sending mail, writing to an outside system, deleting a vault note, changing the computer's setup. Saying ok in chat for a whole kind of action skips the prompt for an hour. Money is never automated. The approval lasts an hour (or a day on the trusted setting) and is logged.
- **The log is the memory of decisions.** Every gated action, every correction, every skill used gets one dated line in `Log/decisions-{{machine}}-YYYY-MM.md`. After each reply a short digest of the session is written to `Log/sessions/`, so the next session on any machine knows what happened.
- **Proposals, not surprises.** When Claude notices a pattern worth turning into a rule or a skill, it files a proposal in `Log/proposals.md`. The proposal is raised in the flow when the situation comes up again. Only the person's yes changes anything.
- **Preserve history.** Facts are corrected in place with a date; superseded things are marked, never deleted.
- **Nothing is trimmed to fit.** A note is never shortened to make it load. A note that grows too large becomes a short main note with subject notes, every entry moved word for word, on your yes. From then on a new entry goes into the note for its subject.

## Routing table

Topics and the note that answers them. Claude finds notes by frontmatter; this table is for people.

| topic | note | then, if needed |
| --- | --- | --- |
| the standing rules | [[Working Agreements]] | |
| what got done today | [[Mirror the day]] | Log/sessions/ |
| a tool worth a look | [[Scout a tool]] | |
| who should do a step | [[Route a task]] | |
| a passing thought | [[Pin an idea]] | notes-and-ideas/ |
| a note grown too large | [[Split a large note]] | |

## Standing rules

1. Plan, then the person's ok, then go.
2. Put the bottom line first, then a few short bullets.
3. Confirm the end goal before deep work.
4. Never assume; ask until sure.
5. Nothing changes in an outside system without the person's ok.
6. No secrets in the vault: no passwords, keys, or tokens, ever.
7. Preserve history: correct in place with dates, never delete on your own judgment.
8. At session end, write what was learned into the matching note.
9. Nothing is trimmed to fit; a note too large is split into a main note and subject notes, word for word, after the person's yes.
10. Read the whole note and follow its links to the end before answering.
11. Check every place before stating a fact; when it is not there, say "I could not find a definite answer".
12. Ask one direct question at a time, in the message itself.

## Phrasebook

Words that mean "do it" versus words that mean "we are talking". The person fills this in; Claude acts only on the action words.

| action words | talk words |
| --- | --- |
| go, do it, ok go | what if, I wonder, maybe we should |
