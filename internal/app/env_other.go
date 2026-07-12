//go:build !windows

package app

// ensureSystemPath is a no-op on non-Windows: Unix launchers don't strip
// /usr/bin / /bin from PATH, so there's nothing to repair.
func ensureSystemPath() {}
