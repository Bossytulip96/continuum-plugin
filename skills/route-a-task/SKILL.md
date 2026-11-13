---
name: route-a-task
description: "Choose who should handle a concrete step; use when asked to route a task"
user-invocable: true
---

# Route a task

1. Confirm the end goal, acceptance check, inputs, and boundaries.
2. Divide the work into steps with clear outputs.
3. Route personal judgment and permissions to the person; a small private repeatable step to an available local model; independent bounded work to an available helper; ambiguous reasoning and integration to the main model. Never assume an unavailable capability.
4. Give each executor exact inputs, what to avoid changing, the output format, and a check.
5. Review the evidence before accepting the output. Keep gated actions pending until the person answers the permission prompt. Log the route and its outcome.

Use config through scripts/lib/config.js. Preserve dated history. No outside-system change is authorized by choosing this skill. When a gate covers an action, Claude Code shows the person its own permission prompt; describe the action in one line and let them answer it. Run the approve command only when they have said in chat that a whole gate level may go ahead for a while, with their actual words. Money actions cannot be approved.
