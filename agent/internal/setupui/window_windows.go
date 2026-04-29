//go:build windows

package setupui

import (
	wv "github.com/jchv/go-webview2"
)

// openInNativeWindow opens the wizard URL in a real WebView2 window
// (no browser chrome). It blocks until the user closes the window.
func openInNativeWindow(url, title string) error {
	w := wv.NewWithOptions(wv.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		WindowOptions: wv.WindowOptions{
			Title:  title,
			Width:  720,
			Height: 760,
			Center: true,
		},
	})
	if w == nil {
		return errNoWebView2
	}
	defer w.Destroy()

	w.SetTitle(title)
	w.Navigate(url)
	w.Run()
	return nil
}
