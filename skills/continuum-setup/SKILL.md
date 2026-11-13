---
name: continuum-setup
description: "first-run setup for Continuum: six questions, then the vault and config are created"
user-invocable: true
disable-model-invocation: true
---

# First-run setup

Ask exactly six questions, one question per message, in this order. Wait for each answer before asking the next. Never ask for keys or secrets. Never run setup.js before all six answers are present.

1. What name should the vault use for you?
2. Which vault folder should be used? Offer a default named Continuum Vault under the person’s home folder. Resolve it to an absolute path.
3. What machine name should label this device’s logs? Ask for a simple filename-safe label.
4. Which timezone should be used? Offer the system timezone obtained locally.
5. Which autonomy setting: ask or trusted? Explain: ask keeps gates on with approvals lasting one hour. Trusted keeps gates on with approvals lasting 24 hours.

6. May Continuum add the vault folder to Claude Code's allowed folders: yes or no? Explain in one line: Claude Code only reads the folder it was started in without asking, so with no, a session started anywhere else stops with a "Read outside the working directories" prompt the first time it touches a note; with yes, setup adds one line to the person's Claude Code user settings and no session asks about the vault again.

After the sixth answer, run the setup script with all six actual answers as separate, safely quoted arguments. The script lives in the plugin folder that holds this skill: take this skill's base directory (shown when the skill loads), go up two levels, then `scripts/setup.js`. The `${CLAUDE_PLUGIN_ROOT}` variable is NOT set for commands run from chat, so always use that absolute path:

```text
node "<plugin folder>/scripts/setup.js" --person "<name>" --vault "<absolute folder>" --machine "<label>" --timezone "<timezone>" --autonomy "<ask or trusted>" --allow-folder "<yes or no>"
```

**In Codex** (OpenAI's app or CLI, not Claude Code), add `--host codex` right after the script path, and answer `no` to the sixth question (it is about Claude Code's settings). The script then also writes the vault's Codex hooks file and AGENTS.md and prints five remaining steps: quit and reopen the Codex app, File > Open Folder > the vault, Settings > Hooks > Trust all, pick "On your computer" at the message box, then ask "What are my standing rules?". Show those steps to the person exactly as printed. Everything below is for Claude Code.

The script does the whole job, including the allowed-folder line when the answer was yes. Never read or edit the Claude Code settings file yourself: that is what makes extra prompts appear. The script refuses to run without `--allow-folder`, so the sixth question cannot be skipped.

- With yes, when Continuum was already set up before, the gate treats this command as a system change and Claude Code shows the person a Continuum prompt. Say beforehand, in one line, that the prompt is expected and the answer is theirs. If they choose No there, run the same command again with `--allow-folder "no"`.
- With no, tell them they can start Claude from inside the vault folder, or with `claude --add-dir "<vault>"`, whenever they want it read without a prompt.

Show the printed result, every line of it. A nonempty vault is preserved; a second run updates config without overwriting notes.

Finish by telling the person to start a new session so hooks load the vault.

For future gated actions, Claude Code will show the person its own permission prompt with the gate’s reason; explain the exact action in one line and let them answer the prompt. Run the approve command only when the person has said in chat that a whole gate level may go ahead for a while, with their actual words. Never invent consent, infer it from a proposal, or approve money actions.
