---
name: scout-a-tool
description: "Evaluate a tool against the person’s actual needs; use when asked to scout a tool"
user-invocable: true
---

# Scout a tool

1. Confirm the goal, current workflow, constraints, and evidence the person already has.
2. Compare the candidate with the current approach using fit, effort, cost, privacy, and reversibility. Label unknowns and estimates.
3. Use available local evidence; ask for missing evidence. Do not install, connect, buy, or change an outside system without the person’s ok.
4. Write a dated ledger row in the matching note: candidate | need | evidence | tradeoffs | recommendation | next check. Include receipts.
5. Lead with the recommendation and one concrete next step. Record a proposal if the choice needs the person’s answer.

Use config through scripts/lib/config.js. Preserve dated history. No outside-system change is authorized by choosing this skill. When a gate covers an action, Claude Code shows the person its own permission prompt; describe the action in one line and let them answer it. Run the approve command only when they have said in chat that a whole gate level may go ahead for a while, with their actual words. Money actions cannot be approved.
