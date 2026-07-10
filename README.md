# Ash

> A frameless Windows terminal with a built-in AI agent — one window for your shell and your model.

![version](https://img.shields.io/github/v/tag/xn0tdev/ash?style=flat-square&color=2563eb&label=version)
![CI](https://img.shields.io/github/actions/workflow/status/xn0tdev/ash/ci.yml?branch=main&style=flat-square&label=CI)
![license](https://img.shields.io/github/license/xn0tdev/ash?style=flat-square&color=2563eb)

<!-- TODO: drop a hero screenshot/demo GIF here once one exists — `![Ash](assets/hero.png)` -->

Ash pairs a real ConPTY terminal with a provider-agnostic agent engine, so you can run shells and drive an agent in the same window. New terminals open in your home directory, sessions survive pane re-parenting, and the agent can run background shells, edit files, grep, glob, fetch the web, and spawn sub-workflows. Any OpenAI-compatible endpoint works as the backend.

## Features

- **Real terminal** — ConPTY-backed xterm.js panes (pwsh/powershell/cmd auto-detected), splits, tabs, drag-to-workspace.
- **Agent engine** — Anthropic-shaped wire types, OpenAI-compatible providers, streaming, tools, skills, roles, permissions.
- **Workspaces** — bind a folder to a workspace; chats and terminals live there.
- **Self-update** — checks GitHub Releases and swaps the binary in place, no installer needed.
- **Frameless** — custom titlebar with Wails drag regions.

## Requirements

- Windows 10/11 (ConPTY). macOS/Linux build is for UI dev only.
- [Go 1.21+](https://go.dev/dl/), [Node 18+](https://nodejs.org/), [Wails CLI v2](https://wails.io/docs/gettingstarted/installation).
- WebView2 Runtime (auto-installed by the installer).

## Quick start

```bash
git clone https://github.com/xn0tdev/ash && cd ash
wails dev          # live dev — Vite on :1420, hot reload
wails build        # production Ash.exe in build/bin/
wails build -nsis  # + NSIS installer → build/bin/Ash-amd64-installer.exe
```

`make build / installer / dev / run / clean` are equivalent — see the [Makefile](Makefile).

## Install (binary)

Download `Ash.exe` from the [latest release](https://github.com/xn0tdev/ash/releases/latest) and run it, or use the NSIS installer which installs to `C:\Program Files\Ash`. On startup Ash checks `/releases/latest` and offers to self-update — a blue **Update** button appears in the sidebar when a new version is out. See [docs/updater.md](docs/updater.md) for the swap flow.

## Versioning

[semver](https://semver.org) — `MAJOR.MINOR.PATCH`. A git tag `vX.Y.Z` triggers [release.yml](.github/workflows/release.yml), which builds a versioned `Ash.exe` (via ldflags) and uploads it to the matching GitHub Release. That asset is what the in-app updater downloads.

## License

MIT — see [LICENSE](LICENSE).
