# Ideas & future work

Features that are **not** implemented yet but worth revisiting. Each idea is
parked here so it isn't lost — pick one up when there's time to scope and build
it properly.

---

## MCP servers (parked 2026-07-10)

Add **Model Context Protocol** server support so the agent can use tools from
external MCP servers (stdio + SSE transports), not just the built-in tools.

### What exists today
- `frontend/src/lib/agent-engine/mcp/` — empty placeholder directory.
- `mcps/pencil/tools/*.json`, `mcps/tasks/tools/*.json` (in the legacy
  spark-renewed tree) — static JSON tool schemas for Pencil and Tasks
  servers. Not wired to anything.
- No MCP client/manager in the current Go/Wails tree. No settings UI.

### What it would take
1. **MCP client** (`mcp/client.ts`) — JSON-RPC over stdio (spawn a server
   process) and SSE (remote HTTP). Handle `initialize`, `tools/list`,
   `tools/call`, server→client requests.
2. **MCP manager** (`mcp/manager.ts`) — load `~/.ash/mcp.json`, spawn/connect
   each configured server, merge its tools into the agent tool registry,
   reconnect on config change, dispose dead servers.
3. **Settings UI** — a new "MCP servers" section in SettingsModal: add/remove
   servers (name, transport, command/url), enable/disable, see live status +
   tool count per server.
4. **Tool registry** — `registry.ts` currently exposes a fixed `TOOLS` array.
   Needs to become dynamic: built-in tools + live MCP tools, with a
   `Map<string,Tool>` (O(1) lookup) rebuilt only when the MCP tool set changes.
5. **Permissions** — MCP tools should flow through the same permission mode
   (confirm / full-auto) as built-in tools. Decide whether unknown MCP tools
   default to "ask".

### Why parked
Scope. The agent engine already has a solid built-in toolset; MCP is a
meaningful expansion that deserves its own focused effort (client + manager +
UI + perms), not a rushed bolt-on. Revisit when the core app is stable.
