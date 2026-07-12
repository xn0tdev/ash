//go:build windows

package app

import "testing"

func TestAppendMissingPathEntriesPreservesOrderAndDeduplicates(t *testing.T) {
	got := appendMissingPathEntries(
		`C:\Windows\System32;C:\Tools\`,
		`c:\tools;C:\Node`,
		`C:\WINDOWS\SYSTEM32\;C:\Bun`,
	)
	want := `C:\Windows\System32;C:\Tools\;C:\Node;C:\Bun`
	if got != want {
		t.Fatalf("appendMissingPathEntries() = %q, want %q", got, want)
	}
}

func TestAppendMissingPathEntriesSkipsBlankSegments(t *testing.T) {
	got := appendMissingPathEntries(`C:\Base`, `;;  ;C:\Extra;;`)
	want := `C:\Base;C:\Extra`
	if got != want {
		t.Fatalf("appendMissingPathEntries() = %q, want %q", got, want)
	}
}
