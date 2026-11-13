"""Drive the installed Continuum adapter the way Hermes would, against a stub ctx.

Usage: python -I hermes_adapter_test.py <hermes home made by setup> <vault>
Only a stub: this proves the adapter's mapping and fail-safe behaviour, not real Hermes.
"""
import importlib.util
import json
import pathlib
import shutil
import sys

home = pathlib.Path(sys.argv[1])
vault = pathlib.Path(sys.argv[2])
plugin = home / "plugins" / "continuum"
checks = 0


def ok(name):
    global checks
    checks += 1
    print("PASS adapter %d: %s" % (checks, name))


def load(name):
    spec = importlib.util.spec_from_file_location(name, plugin / "__init__.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Ctx:
    def __init__(self):
        self.hooks = {}

    def register_hook(self, name, fn):
        self.hooks[name] = fn


def fm(path, key):
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(key + ":"):
            return line.split(":", 1)[1].strip().strip('"')
    return None


def copies(path):
    data = path.read_bytes()
    return sum(1 for f in (vault / ".backups").rglob(path.name) if f.is_file() and f.read_bytes() == data)


mod = load("continuum_adapter")
ctx = Ctx()
mod.register(ctx)
h = ctx.hooks
assert sorted(h) == sorted(["on_session_start", "pre_llm_call", "pre_tool_call", "post_llm_call",
                            "on_session_end", "on_session_finalize", "post_approval_response"]), sorted(h)
ok("register adds the seven hooks")

topic = vault / "Knowledge" / "Adapter Topic.md"
topic.write_text('---\ntype: reference\npattern: adapter-topic\nabout: x\nwhen_to_use: "orange widget"\n'
                 'trust: ask\nstatus: active\nsuperseded_by: ""\nlast_used: ""\ntimes_used: 0\n---\nADAPTER BODY\n',
                 encoding="utf-8")
assert h["on_session_start"](session_id="s1") is None
first = h["pre_llm_call"](session_id="s1", user_message=[{"type": "text", "text": "tell me about the orange widget"}],
                          is_first_turn=True, conversation_history=[])
assert first and "# START HERE" in first["context"], first
assert "ADAPTER BODY" in first["context"]
assert first["context"].index("# START HERE") < first["context"].index("ADAPTER BODY")
assert fm(topic, "times_used") == "1", fm(topic, "times_used")
ok("first turn: start page first, then the routed note; times_used bumped once")
again = h["pre_llm_call"](session_id="s1", user_message="hello there", is_first_turn=False)
assert again is None or "# START HERE" not in again.get("context", ""), again
ok("a later turn with no routed phrase adds no start page")

home_note = vault / "Home.md"
before = copies(home_note)
res = h["pre_tool_call"](tool_name="terminal", args={"command": 'Remove-Item -LiteralPath "%s"' % home_note}, session_id="s1")
assert res and res["action"] == "approve" and res["rule_key"] == "continuum:vault-delete", res
assert res["message"].startswith("[continuum]")
assert copies(home_note) == before + 1
ok("terminal delete of a vault note: approval card continuum:vault-delete, dated copy made")
res = h["pre_tool_call"](tool_name="write_file", args={"path": str(home_note), "content": ""}, session_id="s1")
assert res and res["action"] == "approve" and res["rule_key"] == "continuum:vault-delete", res
assert h["pre_tool_call"](tool_name="write_file", args={"path": str(home_note), "content": "New text"}, session_id="s1") is None
assert h["pre_tool_call"](tool_name="patch", args={"path": str(home_note), "old_string": "x", "new_string": "y"}, session_id="s1") is None
assert h["pre_tool_call"](tool_name="read_file", args={"path": str(home_note)}, session_id="s1") is None
ok("write_file emptying a note asks; ordinary write, patch and read pass")
res = h["pre_tool_call"](tool_name="mcp__shop__checkout", args={}, session_id="s1")
assert res and res["action"] == "block" and "money" in res["message"], res
ok("a money tool named like mcp__<server>__checkout is blocked (generic Hermes tool names are not classified)")
h["post_approval_response"](command="rm", description="[continuum] vault-delete: ...", pattern_key="continuum:vault-delete", choice="deny")
logs = "".join(p.read_text(encoding="utf-8") for p in (vault / "Log").glob("decisions-*.md"))
assert "approval card" in logs and "person chose deny" in logs
ok("post_approval_response logs the choice")

h["pre_llm_call"](session_id="s2", user_message="Digest first message", is_first_turn=True)
h["post_llm_call"](session_id="s2", user_message="Digest first message", assistant_response="The reply text.", conversation_history=[])
h["on_session_end"](session_id="s2")
digests = [p for p in (vault / "Log" / "sessions").glob("*.md") if fm(p, "session") == "s2"]
assert len(digests) == 1, digests
text = digests[0].read_text(encoding="utf-8")
assert "Digest first message" in text and "The reply text." in text and fm(digests[0], "status") == "closed"
assert fm(digests[0], "host") == "hermes"
ok("post_llm_call then on_session_end leaves one closed digest")

side = plugin / "continuum.json"
saved = side.read_text(encoding="utf-8")
side.write_text("{broken", encoding="utf-8")
broken = load("continuum_broken")
c2 = Ctx()
broken.register(c2)
for name, kw in (("pre_llm_call", {"session_id": "s3", "user_message": "orange widget", "is_first_turn": True}),
                 ("pre_tool_call", {"tool_name": "terminal", "args": {"command": "rm x"}, "session_id": "s3"}),
                 ("post_llm_call", {"session_id": "s3", "assistant_response": "x"}),
                 ("on_session_end", {"session_id": "s3"}), ("on_session_start", {"session_id": "s3"}),
                 ("post_approval_response", {"pattern_key": "continuum:x", "choice": "once"})):
    assert c2.hooks[name](**kw) is None, name
side.write_text(json.dumps({"root": str(home / "nowhere"), "node": "node", "config": str(home / "none.json")}), encoding="utf-8")
assert c2.hooks["pre_tool_call"](tool_name="terminal", args={"command": "rm x"}) is None
side.write_text(saved, encoding="utf-8")
ok("a broken sidecar makes every hook return None without raising")
print("PASS adapter: %d groups" % checks)
