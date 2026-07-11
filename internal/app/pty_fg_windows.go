//go:build windows

package app

import (
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ForegroundProcess is the deepest tty-attached descendant of a ConPTY's root
// shell — the program actually driving the terminal right now (e.g. claude.exe,
// agy.exe, opencode.exe, or the shell itself when nothing else is running).
type ForegroundProcess struct {
	Name string `json:"name"`
	Pid  int    `json:"pid"`
}

// kernel32 process-snapshot helpers. golang.org/x/sys/windows doesn't wrap
// Toolhelp32, so call them directly via LazyDLL — same pattern conpty uses for
// its pseudoconsole calls.
var (
	kernel32              = windows.NewLazySystemDLL("kernel32.dll")
	procCreateToolhelp32  = kernel32.NewProc("CreateToolhelp32Snapshot")
	procProcess32FirstW   = kernel32.NewProc("Process32FirstW")
	procProcess32NextW    = kernel32.NewProc("Process32NextW")
	procCloseHandle       = kernel32.NewProc("CloseHandle")
)

const (
	th32csSnapProcess = 0x00000002
	maxPath           = 260
)

// passthroughProcs are processes we descend THROUGH, never treat as the
// foreground program: shells, runtimes, and launch shims. The agent binaries
// (claude.exe / agy.exe / opencode.exe) are NOT here — they're the leaves we
// stop at. This is what prevents a CLI agent's own children (MCP servers as
// node.exe, tool sub-processes) from being mistaken for the foreground: we
// stop at the agent and never visit its descendants.
var passthroughProcs = map[string]struct{}{
	"pwsh.exe": {}, "powershell.exe": {}, "cmd.exe": {},
	"node.exe": {}, "npx.cmd": {}, "npm.cmd": {},
	"bun.exe": {},
	"wsl.exe": {}, "bash.exe": {}, "sh.exe": {}, "zsh.exe": {},
	"git.exe": {}, "where.exe": {}, "conhost.exe": {},
}

// processEntryW mirrors PROCESSENTRY32W. Field order and sizes must match the
// Windows struct exactly — the snapshot API copies it raw into our buffer.
type processEntryW struct {
	dwSize                uint32
	cntUsage              uint32
	th32ProcessID         uint32
	th32DefaultHeapID     uintptr
	th32ModuleID          uint32
	cntThreads            uint32
	th32ParentProcessID   uint32
	pcPriClassBase        int32
	dwFlags               uint32
	szExeFile             [maxPath]uint16
}

// foregroundProcess walks the process tree under rootPid and returns the
// foreground program driving the ConPTY. From the root shell it descends
// THROUGH passthrough processes (shells, node, npx, …) and STOPS at the first
// non-passthrough descendant — the actual program on screen (claude.exe /
// agy.exe / opencode.exe). Stopping at the agent (instead of descending to
// its deepest child) is what keeps a match stable while the agent spawns MCP
// servers / tool sub-processes as node.exe children. Returns the root itself
// when nothing but a bare shell prompt is running (no match).
func foregroundProcess(rootPid int) (ForegroundProcess, error) {
	if rootPid <= 0 {
		return ForegroundProcess{}, fmt.Errorf("no root pid")
	}

	// Invalid handle value is -1 (INVALID_HANDLE_VALUE) on all Windows builds.
	handle, _, err := procCreateToolhelp32.Call(uintptr(th32csSnapProcess), 0)
	if handle == uintptr(^uintptr(0)) {
		return ForegroundProcess{}, fmt.Errorf("CreateToolhelp32Snapshot: %w", err)
	}
	defer procCloseHandle.Call(handle)

	// Build pid → {name, parent} for every process in the system, then walk the
	// tree ourselves. One snapshot + one pass is cheaper than repeated
	// first/next walks per branch.
	type info struct {
		name   string
		parent uint32
	}
	procs := map[uint32]info{}

	entry := processEntryW{dwSize: uint32(unsafe.Sizeof(processEntryW{}))}
	r, _, _ := procProcess32FirstW.Call(handle, uintptr(unsafe.Pointer(&entry)))
	if r == 0 {
		return ForegroundProcess{}, nil // empty snapshot — no processes, shouldn't happen
	}
	for {
		name := windows.UTF16ToString(entry.szExeFile[:])
		procs[entry.th32ProcessID] = info{name: name, parent: entry.th32ParentProcessID}
		entry = processEntryW{dwSize: uint32(unsafe.Sizeof(processEntryW{}))}
		r, _, _ := procProcess32NextW.Call(handle, uintptr(unsafe.Pointer(&entry)))
		if r == 0 {
			break
		}
	}

	// Collect a process's children once per level.
	childrenOf := func(parent uint32) []uint32 {
		var out []uint32
		for pid, inf := range procs {
			if inf.parent == parent {
				out = append(out, pid)
			}
		}
		return out
	}

	cur := uint32(rootPid)
	visited := map[uint32]struct{}{cur: {}}
	for {
		children := childrenOf(cur)
		if len(children) == 0 {
			break // leaf — cur is the foreground (e.g. a bare shell prompt)
		}
		// Prefer a non-passthrough child (the actual program); fall back to a
		// passthrough child (shell/wrapper) to keep descending. A non-passthrough
		// child is the stop point — we do NOT visit its descendants, so an
		// agent's MCP/tool children never displace it as the match.
		var next uint32
		var passthroughChild uint32
		for _, pid := range children {
			name := strings.ToLower(procs[pid].name)
			if _, ok := passthroughProcs[name]; !ok {
				next = pid
				break
			}
			if passthroughChild == 0 {
				passthroughChild = pid
			}
		}
		if next != 0 {
			cur = next
			break // found the foreground program — stop descending
		}
		if passthroughChild == 0 {
			break // no usable child
		}
		if _, seen := visited[passthroughChild]; seen {
			break // cycle guard (shouldn't happen, but don't loop forever)
		}
		visited[passthroughChild] = struct{}{}
		cur = passthroughChild
	}
	return ForegroundProcess{Name: strings.ToLower(procs[cur].name), Pid: int(cur)}, nil
}
