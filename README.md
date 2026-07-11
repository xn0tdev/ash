# Ash

> A frameless Windows terminal with a built-in AI agent — one window for your shell and your model.

![version](https://img.shields.io/github/v/tag/xn0tdev/ash?style=flat-square&color=2563eb&label=version)
![CI](https://img.shields.io/github/actions/workflow/status/xn0tdev/ash/ci.yml?branch=main&style=flat-square&label=CI)
![license](https://img.shields.io/github/license/xn0tdev/ash?style=flat-square&color=2563eb)

<!-- TODO: drop a hero screenshot/demo GIF here once one exists — `![Ash](assets/hero.png)` -->

Ash pairs a real terminal with a provider-agnostic agent engine (Go + React, via Wails), so you can run shells and drive an agent in the same window. Any OpenAI-compatible endpoint works as the model backend; new terminals open in your home directory; sessions survive pane re-parenting; and updates land by swapping the binary in place — no installer needed.

## Features

- **Self-updates by swapping the binary** — no installer, no setup wizard, no UAC prompt on the happy path. A blue Update button in the sidebar appears when a new release is out; click it and Ash restarts on the new version. Most updaters drag you through a wizard and an admin prompt.
- **Terminal + agent in one window** — run a real shell and drive an AI agent side by side; the agent can run commands, edit files, grep, glob, fetch the web, and spawn background shells you can read back later. No separate chat app + terminal juggling.
- **New terminals open in your home dir, not the install folder** — the default cwd falls back to `~`, not `C:\Program Files\Ash`. Most apps plop you in their own directory.
- **Reliable terminal paste** — Ctrl+V / Ctrl+Shift+V and right-click paste use the clipboard directly; normal paste events from dictation apps such as Wispr Flow are handled without duplicate insertion.
- **Workspaces that stick** — bind a folder to a workspace; chats and terminals live there. Drag a tab onto a workspace and its terminal re-points to that folder, history intact.
- **Any OpenAI-compatible model** — drop in your endpoint and key; the agent works with whatever provider you point it at, no vendor lock-in.

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

## Install

Download `Ash.exe` from the [latest release](https://github.com/xn0tdev/ash/releases/latest) and run it, or grab the NSIS installer `Ash-Setup-v*.exe` for a standard Windows install (it installs to `C:\Program Files\Ash` and adds Start-menu / desktop shortcuts). On startup Ash checks `/releases/latest` and offers to self-update — a blue **Update** button appears in the sidebar when a new version is out. See [docs/updater.md](docs/updater.md) for the swap flow.

## Versioning

[semver](https://semver.org) — `MAJOR.MINOR.PATCH`. A git tag `vX.Y.Z` triggers [release.yml](.github/workflows/release.yml), which builds a versioned `Ash.exe` (via ldflags) and uploads it to the matching GitHub Release. That asset is what the in-app updater downloads.

## License

MIT — see [LICENSE](LICENSE).
