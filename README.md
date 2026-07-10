# Ash

A frameless Windows terminal + AI agent app built with [Wails](https://wails.io) (Go) + React + xterm.js.

Ash pairs a real ConPTY terminal with a provider-agnostic agent engine (any
OpenAI-compatible endpoint) so you can run shells and drive an agent in the
same window. New terminals open in your home directory, sessions survive pane
re-parenting, and the agent can run background shells, edit files, grep, glob,
fetch the web, and spawn sub-workflows.

## Features

- **Real terminal** — ConPTY-backed xterm.js panes (pwsh/powershell/cmd auto-detected), splits, tabs, drag-to-workspace.
- **Agent engine** — Anthropic-shaped wire types, OpenAI-compatible providers, streaming, tools, skills, roles, permissions.
- **Workspaces** — bind a folder to a workspace; chats/terminals live there.
- **Explorer, command palette, run modal, SSH launcher, settings.**
- **Self-update** — checks GitHub Releases and swaps the binary in place (no installer needed). See [docs/updater.md](docs/updater.md).
- **Frameless** — custom titlebar with Wails drag regions.

## Requirements

- Windows 10/11 (ConPTY). macOS/Linux build for UI dev only.
- [Go 1.21+](https://go.dev/dl/), [Node 18+](https://nodejs.org/), [Wails CLI v2](https://wails.io/docs/gettingstarted/installation).
- WebView2 Runtime (auto-installed by the installer).

## Build

```bash
wails dev          # live dev (Vite on :1420)
wails build        # production Ash.exe in build/bin
wails build -nsis  # + NSIS installer
```

See the [Makefile](Makefile) for `make build / installer / dev / run / clean`.

## Install

Download `Ash.exe` from the [latest release](https://github.com/xn0tdev/ash/releases/latest), or run the NSIS installer which installs to `C:\Program Files\Ash`.

## Versioning

Ash follows [semver](https://semver.org): `MAJOR.MINOR.PATCH`. Releases are
git tags `vX.Y.Z`; each tag triggers a GitHub Actions build that uploads
`Ash.exe` to the corresponding Release. The app checks
`/releases/latest` on startup and offers to self-update.

## Project layout

```
*.go              # Wails backend: ConPTY (pty_*.go), fs, git, tools, sandbox, updater
frontend/src/
  App.tsx         # top-level state + tab/workspace wiring
  components/     # TitleBar, Sidebar, AgentThread, TerminalPane, modals, Explorer
  lib/            # term sessions, agent-engine (loop/providers/tools/skills), settings, pty
  shim/           # @tauri-apps/* → Wails compatibility shims
build/windows/    # NSIS installer + icon
```

## License

[MIT](LICENSE) © xn0tdev
