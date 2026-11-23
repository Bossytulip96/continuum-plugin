'use strict';
// Which agent runs this script: "claude" (Claude Code, the default) or "codex" (OpenAI Codex).
// The Codex hook file passes --host codex on every command; CONTINUUM_HOST=codex does the same
// for a shell. The flag is taken out of process.argv when this file loads, so every script's own
// argument parsing (approve, setup, proposal, decision-log) sees exactly what it saw before.
// Hermes Agent (--host hermes) is the third host; its Python adapter starts every script with the flag.
// Google Antigravity (--host antigravity) is the fourth; scripts/antigravity-hook.js selects it itself.
const HOSTS = ['claude', 'codex', 'hermes', 'antigravity'];
function pick(argv, env) {
  for (let i = 0; i < argv.length; i++) {
    const m = String(argv[i]).match(/^--host(?:=(.*))?$/);
    if (!m) continue;
    const value = m[1] !== undefined ? m[1] : argv[i + 1];
    argv.splice(i, m[1] !== undefined ? 1 : 2);
    return HOSTS.includes(String(value).toLowerCase()) ? String(value).toLowerCase() : 'claude';
  }
  const fromEnv = String(env.CONTINUUM_HOST || '').toLowerCase();
  return HOSTS.includes(fromEnv) ? fromEnv : 'claude';
}
let current = pick(process.argv, process.env);
const name = () => current;
const isCodex = () => current === 'codex';
const isHermes = () => current === 'hermes';
const isAntigravity = () => current === 'antigravity';
// Codex, Hermes and Antigravity give no stable transcript: digests and prompt dedupe come from hook inputs.
// (Antigravity passes a transcriptPath, but its format is not confirmed, so it is not parsed.)
const fromInputs = () => current === 'codex' || current === 'hermes' || current === 'antigravity';
// Tests only: choose the host for code loaded in this process.
function set(value) { current = HOSTS.includes(value) ? value : 'claude'; }
module.exports = { name, isCodex, isHermes, isAntigravity, fromInputs, set, pick, HOSTS };
