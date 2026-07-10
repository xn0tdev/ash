# Ash → Wails (Go) Port Roadmap

Spiking confirmed: Wails/Go feels good (9s builds, ConPTY via 50-line package,
auto-gen bindings, frameless titlebar). Committing to a full port. Original Ash
stays at `~/spark-renewed/` (Tauri/Rust) as the reference.

## Phase 1 — UI foundation
- [x] Frameless titlebar + drag + window controls (`TitleBar.tsx`)
- [x] ConPTY bridge (`pty.go` / `pty_windows.go` via `UserExistsError/conpty`)
- [x] Single xterm pane wired to PTY
- [x] Theme CSS vars (vercel-dark)
- [x] Hide scrollbars; lock window scroll
- [x] Custom app icon
- [ ] Layout / split tree (`layout.ts` — pure TS, port as-is)
- [ ] Multi-tab + Sidebar (`Sidebar.tsx`, tab state)
- [ ] PaneLayout (recursive splits)
- [ ] Welcome screen
- [ ] Themes module (`themes.ts` — as-is)

## Phase 2 — Go backend (port Rust)
- [ ] `fs.go` — read_text/write_text/delete_path/list_dir (port `fs.rs`)
- [ ] `git.go` — branch/status (`go-git/v5` or shell-out; port `git.rs`)
- [ ] `process.go` — kill/tasklist (Windows; port `process.rs`)
- [ ] `ssh.go` — ~/.ssh/config hosts (port the ssh parts of `lib.rs`)
- [ ] Settings persistence (`~/.ash/settings.json` via Go os)

## Phase 3 — Explorer + modals
- [ ] Explorer (`Explorer.tsx` + `fs.go`)
- [ ] CommandPalette, RunModal, UtilityModal, SshModal
- [ ] SettingsModal (providers/models/themes/fonts/clear-on-exit)

## Phase 4 — agent-engine (largest)
- [ ] providers (`openai-compat.ts` — as-is, fetch)
- [ ] loop/session/types/permissions/context/system-prompt/skills/roles
- [ ] tools (bash/read/edit/write/glob/grep/web-fetch/…) — via `fs.go` + `pty.go`
- [ ] AgentThread.tsx (markdown, streaming, tool calls)
- [ ] chat-store (persistence)

## Phase 5 — finish
- [ ] BrowserPane, FileViewer, SandboxMergeModal
- [ ] notifications/sounds, tray
- [ ] Polish + manual test

## Key mappings (Tauri → Wails)
| Tauri | Wails |
|---|---|
| `data-tauri-drag-region` | `--wails-draggable: drag` CSS var |
| `@tauri-apps/api/window` (getCurrentWindow) | `@wailsio/runtime` Window* functions |
| `#[tauri::command]` + `invoke()` | Go exported method → auto-gen `Pty.X()` TS |
| `portable-pty` (ConPTY) | `github.com/UserExistsError/conpty` |
| `tokio` async | goroutines |
| `src-tauri/src/*.rs` | `~/ash-wails/*.go` |

## What ports as-is (no change)
- All pure-TS modules with no `@tauri-apps` imports: `layout.ts`, `themes.ts`,
  `agent-engine/types.ts`, providers, most lib logic.
- All CSS.
- xterm.js, react-markdown, remark-gfm.

## What must be rewritten
- Every `invoke("command", ...)` call → Wails binding method.
- `fs.rs` / `git.rs` / `process.rs` / `pty.rs` / sandbox → Go.
- Window/event API surface (`getCurrentWindow()`, `onCloseRequested` → Wails).
