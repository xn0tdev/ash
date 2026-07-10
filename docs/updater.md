# Self-update

Ash updates itself by **swapping the binary** — no installer, no admin helper
on the happy path. Releases live on GitHub; the app checks the latest release
on startup and offers to update from a blue **Update** button in the titlebar.

## How it works

1. **Check** — on startup (4s after launch) the frontend calls
   `check_update`, which hits
   `https://api.github.com/repos/xn0tdev/ash/releases/latest` and compares the
   release tag (`vX.Y.Z`) against the build-time version (semver,
   component-wise).
2. **Badge** — if the latest release is newer, a blue **Update** button
   appears in the titlebar, immediately after the sidebar toggle.
3. **Download** — clicking it opens the update modal, which calls
   `download_update`. The Go side streams `Ash.exe` to `Ash.exe.new` (sibling
   of the running binary, or `%TEMP%` if the install dir isn't writable),
   emitting `update:progress` events with percent + bytes. The modal renders a
   progress bar.
4. **Install** — `apply_update` swaps the binary in place:
   - rename running `Ash.exe` → `Ash.exe.old` (Windows allows renaming a
     running exe, just not overwriting/deleting it),
   - rename `Ash.exe.new` → `Ash.exe`,
   - spawn the new instance, then `os.Exit(0)`.
   - If the install dir isn't user-writable (Program Files as non-admin), an
     elevated PowerShell snippet does the rename/move (one UAC prompt).
5. **Cleanup** — on the next launch, `Ash.exe.old` is deleted.

## Versioning

[semver](https://semver.org): `MAJOR.MINOR.PATCH`.

- A git tag `vX.Y.Z` triggers `.github/workflows/release.yml`, which builds
  `Ash.exe` with `-ldflags "-X ash-wails/internal/app.Version=X.Y.Z -X ash-wails/internal/app.Commit=<sha>"` and
  uploads it to the corresponding GitHub Release.
- The release asset **must** be named `Ash.exe` — that's what the updater
  looks for (`assetName` in `updater.go`).
- The version defaults to `"dev"` for local `wails build` (no ldflags), so
  any real release is always considered newer.

## Files

- `updater.go` — check / download (progress events) / apply / restart, semver.
- `updater_windows.go` — `relaunch` (detached spawn) + `elevatedSwap` (UAC).
- `updater_other.go` — non-Windows stubs (dev only).
- `frontend/src/lib/updater.ts` — reactive store + event stream.
- `frontend/src/components/UpdateModal.tsx` — progress modal.
- `.github/workflows/release.yml` — tagged-release CI.
