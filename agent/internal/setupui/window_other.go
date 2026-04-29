//go:build !windows

package setupui

// openInNativeWindow falls back to opening the user's default browser on
// non-Windows platforms. Returns errNoWebView2 to signal "no native window
// available; caller should keep the HTTP server running until done."
func openInNativeWindow(url, title string) error {
	return errNoWebView2
}
