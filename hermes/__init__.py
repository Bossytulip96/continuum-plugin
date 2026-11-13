"""Continuum for Hermes Agent: a thin adapter over the package's Node scripts.

Each Hermes hook is turned into the JSON a Node hook script takes on stdin, the script runs with
--host hermes, and its answer is mapped back. No rule lives here. Every hook is best effort: on
any error it returns None and the conversation continues. Setup writes continuum.json next to
this file: {"root": "<package folder>", "node": "<node exe>", "config": "<config.json path>"}.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_SEEN = set()  # session ids that already got the start page
_TIMEOUT = 8
_NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW: no console window flashes on Windows


def _sidecar():
    try:
        data = json.loads((_HERE / "continuum.json").read_text(encoding="utf-8-sig"))
        if isinstance(data, dict) and data.get("root") and data.get("config"):
            return data
    except Exception:
        pass
    return None


def _vault(side):
    try:
        cfg = json.loads(Path(side["config"]).read_text(encoding="utf-8-sig"))
        return str(cfg.get("vault") or "")
    except Exception:
        return ""


def _call(script, args=None, payload=None):
    """Run one Node script with --host hermes; return parsed stdout JSON (or {}), None on failure."""
    side = _sidecar()
    if not side:
        return None
    try:
        cmd = [side.get("node") or "node", str(Path(side["root"]) / "scripts" / script), "--host", "hermes"]
        cmd += list(args or [])
        env = dict(os.environ)
        env["CONTINUUM_CONFIG"] = str(side["config"])
        extra = {"creationflags": _NO_WINDOW} if sys.platform == "win32" else {}
        done = subprocess.run(cmd, input=json.dumps(payload or {}), capture_output=True, text=True,
                              encoding="utf-8", timeout=_TIMEOUT, env=env, cwd=str(side["root"]), **extra)
        out = (done.stdout or "").strip()
        if not out.startswith("{"):
            return {}
        data = json.loads(out)
        return data if isinstance(data, dict) else {}
    except Exception:
        return None


def run(script, payload):
    return _call(script, None, payload)


def _payload(event, session_id, **fields):
    side = _sidecar() or {}
    base = {"session_id": str(session_id or "hermes"), "transcript_path": None, "cwd": _vault(side),
            "hook_event_name": event}
    base.update(fields)
    return base


def _context(answer):
    try:
        return ((answer or {}).get("hookSpecificOutput") or {}).get("additionalContext") or ""
    except Exception:
        return ""


def _text(message):
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        parts = []
        for item in message:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(message or "")


def on_session_start(session_id="", **kwargs):
    return None  # the start page is loaded on the first pre_llm_call, where it can reach the model


def pre_llm_call(session_id="", user_message="", is_first_turn=False, **kwargs):
    try:
        prompt = _text(user_message)
        parts = []
        sid = str(session_id or "hermes")
        if is_first_turn or sid not in _SEEN:
            _SEEN.add(sid)
            parts.append(_context(run("session-start.js", _payload("SessionStart", sid, source="startup"))))
        parts.append(_context(run("prompt-route.js", _payload("UserPromptSubmit", sid, prompt=prompt))))
        run("session-digest.js", _payload("UserPromptSubmit", sid, prompt=prompt))
        joined = "\n\n".join(p for p in parts if p)
        return {"context": joined} if joined else None
    except Exception:
        return None


_EDIT_FIELDS = (("old_string", "new_string"), ("old", "new"), ("search", "replace"),
                ("old_text", "new_text"), ("find", "replace"))


def _tool(tool_name, args):
    """Hermes tool -> the gate's tool name and input."""
    args = args if isinstance(args, dict) else {}
    if tool_name == "terminal":
        return "Bash", {"command": str(args.get("command", "") or "")}
    if tool_name == "write_file":
        return "Write", {"file_path": str(args.get("path", "") or ""), "content": str(args.get("content", "") or "")}
    if tool_name == "patch":
        path = str(args.get("path", "") or args.get("file_path", "") or "")
        for old, new in _EDIT_FIELDS:
            if old in args and new in args:
                return "Edit", {"file_path": path, "old_string": str(args.get(old) or ""),
                                "new_string": str(args.get(new) or ""), "replace_all": bool(args.get("replace_all"))}
        # Unknown patch shape: a Write with unknown (non-empty) content, so the note is copied and allowed.
        return "Write", {"file_path": path, "content": "(patch)"}
    return str(tool_name or ""), args


def pre_tool_call(tool_name="", args=None, session_id="", **kwargs):
    try:
        name, tool_input = _tool(tool_name, args)
        answer = run("action-gate.js", _payload("PreToolUse", session_id, tool_name=name, tool_input=tool_input))
        out = (answer or {}).get("hookSpecificOutput") or {}
        decision = out.get("permissionDecision")
        reason = str(out.get("permissionDecisionReason") or "[continuum]")
        if decision == "deny":
            return {"action": "block", "message": reason}
        if decision == "ask":
            levels = out.get("continuumLevels") or ["gate"]
            return {"action": "approve", "message": reason, "rule_key": "continuum:" + str(levels[0])}
        return None
    except Exception:
        return None


def post_approval_response(command="", description="", pattern_key="", choice="", **kwargs):
    try:
        key = str(pattern_key or "")
        if "continuum" in key.lower() or "[continuum]" in str(description):
            level = key.split(":", 1)[1] if key.lower().startswith("continuum:") else "gate"
            _call("decision-log.js", ["action: approval card", level, "person chose " + str(choice),
                                      str(description or command)[:300]])
    except Exception:
        pass
    return None


def post_llm_call(session_id="", user_message="", assistant_response="", conversation_history=None, **kwargs):
    try:
        run("session-digest.js", _payload("Stop", session_id, stop_hook_active=False,
                                          last_assistant_message=_text(assistant_response)))
    except Exception:
        pass
    return None


def on_session_end(session_id="", **kwargs):
    try:
        run("session-digest.js", _payload("SessionEnd", session_id, reason="other"))
    except Exception:
        pass
    return None


def register(ctx):
    for name, fn in (("on_session_start", on_session_start), ("pre_llm_call", pre_llm_call),
                     ("pre_tool_call", pre_tool_call), ("post_llm_call", post_llm_call),
                     ("on_session_end", on_session_end), ("on_session_finalize", on_session_end),
                     ("post_approval_response", post_approval_response)):
        try:
            ctx.register_hook(name, fn)
        except Exception:
            pass
