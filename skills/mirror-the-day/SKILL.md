---
name: mirror-the-day
description: "Say back completed work with receipts; use when asked to mirror the day"
user-invocable: true
---

# Mirror the day

Read only. This skill reports; it changes nothing and assigns nothing. The full method is the vault note Knowledge/Skills/Mirror the day.md; follow it when it is present.

1. Fix the window: today by default, Monday to now for "this week", or the range the person names.
2. Read the receipts: the dated decision records, the session digests updated in the window, the dated lines in Home.md, and notes whose last_used falls in the window. Never read the session transcript itself.
3. Sort into four piles: shipped, invisible (settled something, left no artifact), open, ruled out. A stated intention does not count as completion.
4. Say it back: one honest bottom line, then the shipped and invisible lists, each line with its receipt in parentheses. Open and ruled out as one line each with counts.
5. If the piles are thin, say so and name the cause from the record. Never "you should have". Never a suggested next task.

Use config through scripts/lib/config.js. No outside-system change is authorized by choosing this skill.
