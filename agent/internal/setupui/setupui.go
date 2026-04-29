// Package setupui implements a local-loopback HTTP wizard that walks an
// operator through agent pairing without forcing them onto the CLI.
package setupui

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/serverkit/agent/internal/config"
	"github.com/serverkit/agent/internal/logger"
	"github.com/serverkit/agent/internal/metrics"
	"github.com/serverkit/agent/internal/pairing"
)

//go:embed wizard.html
var wizardHTML []byte

// errNoWebView2 signals that a native WebView2 window could not be opened
// and the caller should fall back to the system browser.
var errNoWebView2 = errors.New("native window unavailable")

// Server hosts the local pairing wizard.
type Server struct {
	log        *logger.Logger
	configPath string

	mu       sync.RWMutex
	state    *State
	cancel   context.CancelFunc
	doneCh   chan struct{}
	listener net.Listener
}

// State is the JSON shape returned by /api/status.
type State struct {
	Phase         string `json:"phase"` // idle | enrolling | waiting | claimed | error
	PanelURL      string `json:"panel_url,omitempty"`
	PairCode      string `json:"pair_code,omitempty"`
	PairCodeShort string `json:"pair_code_short,omitempty"`
	Fingerprint   string `json:"fingerprint,omitempty"`
	ServerName    string `json:"server_name,omitempty"`
	ErrorMessage  string `json:"error,omitempty"`
}

// New constructs a wizard server using the given config path for credential persistence.
func New(log *logger.Logger, configPath string) *Server {
	return &Server{
		log:        log.WithComponent("setupui"),
		configPath: configPath,
		state:      &State{Phase: "idle"},
	}
}

// Run starts the HTTP server, opens a browser and blocks until pairing
// completes (success or user cancel) or ctx is cancelled.
func (s *Server) Run(ctx context.Context) error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	s.listener = ln

	s.doneCh = make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/start", s.handleStart)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/cancel", s.handleCancel)
	mux.HandleFunc("/api/close", s.handleClose)

	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		_ = srv.Serve(ln)
	}()

	url := fmt.Sprintf("http://%s/", ln.Addr().String())
	fmt.Printf("ServerKit Agent — pairing wizard:\n  %s\n\n", url)

	// Try native window first (Windows: WebView2). On failure or non-Windows,
	// fall back to opening in the user's default browser.
	useBrowser := true
	go func() {
		err := openInNativeWindow(url, "ServerKit Agent · Setup")
		if err == nil {
			// Window closed — signal done so we shut down.
			s.signalDone()
		}
		// errNoWebView2 means we never got a window; the browser fallback
		// runs synchronously below, so nothing else to do here.
		_ = err
	}()

	// Give the native window a brief moment to come up before deciding to
	// open the browser. If the goroutine has already errored, fall back.
	time.Sleep(150 * time.Millisecond)
	if runtime.GOOS == "windows" {
		// On Windows we trust WebView2 (ships with Win10+). If WebView2 is
		// missing the native call returns errNoWebView2 quickly — but the
		// goroutine may still be initializing, so we don't open a browser
		// here. The user will see the native window.
		useBrowser = false
		fmt.Println("Opening setup window…")
		fmt.Println("Leave this terminal open until pairing completes. Press Ctrl+C to cancel.")
	}
	if useBrowser {
		fmt.Println("Opening in your default browser…")
		fmt.Println("Leave this terminal open until pairing completes. Press Ctrl+C to cancel.")
		if err := openBrowser(url); err != nil {
			s.log.Warn("could not open browser automatically", "error", err)
			fmt.Println("(Couldn't open browser automatically — copy the URL above into your browser.)")
		}
	}

	select {
	case <-ctx.Done():
	case <-s.doneCh:
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)

	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state.Phase == "error" {
		return fmt.Errorf("pairing failed: %s", s.state.ErrorMessage)
	}
	return nil
}

// ---- handlers ----

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(wizardHTML)
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PanelURL   string `json:"panel_url"`
		Passphrase string `json:"passphrase"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	req.PanelURL = strings.TrimSpace(req.PanelURL)
	req.Passphrase = strings.TrimSpace(req.Passphrase)
	if req.PanelURL == "" || req.Passphrase == "" {
		http.Error(w, "panel_url and passphrase are required", http.StatusBadRequest)
		return
	}
	if len(req.Passphrase) < 4 {
		http.Error(w, "passphrase must be at least 4 characters", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(req.PanelURL, "http://") && !strings.HasPrefix(req.PanelURL, "https://") {
		req.PanelURL = "https://" + req.PanelURL
	}

	s.mu.Lock()
	if s.state.Phase != "idle" && s.state.Phase != "error" && s.state.Phase != "claimed" {
		s.mu.Unlock()
		http.Error(w, "pairing already in progress", http.StatusConflict)
		return
	}
	if s.cancel != nil {
		s.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.state = &State{Phase: "enrolling", PanelURL: req.PanelURL}
	s.mu.Unlock()

	go s.runPairing(ctx, req.PanelURL, req.Passphrase)

	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	state := *s.state
	s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(state)
}

func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.state = &State{Phase: "idle"}
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleClose(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
	go func() {
		time.Sleep(200 * time.Millisecond)
		s.signalDone()
	}()
}

func (s *Server) signalDone() {
	select {
	case <-s.doneCh:
	default:
		close(s.doneCh)
	}
}

// ---- pairing driver ----

func (s *Server) runPairing(ctx context.Context, panelURL, passphrase string) {
	setErr := func(msg string) {
		s.mu.Lock()
		s.state.Phase = "error"
		s.state.ErrorMessage = msg
		s.mu.Unlock()
	}

	kp, err := pairing.LoadOrCreate(pairing.DefaultKeyPath())
	if err != nil {
		setErr(fmt.Sprintf("could not load keypair: %v", err))
		return
	}

	collector := metrics.NewCollector(config.MetricsConfig{}, s.log)
	infoCtx, infoCancel := context.WithTimeout(ctx, 8*time.Second)
	sysInfo, _ := collector.GetSystemInfo(infoCtx)
	infoCancel()
	sysMap := map[string]interface{}{}
	if sysInfo != nil {
		sysMap = map[string]interface{}{
			"hostname":         sysInfo.Hostname,
			"os":               sysInfo.OS,
			"platform":         sysInfo.Platform,
			"platform_version": sysInfo.PlatformVersion,
			"architecture":     sysInfo.Architecture,
			"cpu_cores":        sysInfo.CPUCores,
			"total_memory":     sysInfo.TotalMemory,
			"total_disk":       sysInfo.TotalDisk,
		}
	} else {
		hostname, _ := os.Hostname()
		sysMap["hostname"] = hostname
		sysMap["os"] = runtime.GOOS
		sysMap["architecture"] = runtime.GOARCH
	}

	client := pairing.NewClient(panelURL, s.log)
	enrollCtx, enrollCancel := context.WithTimeout(ctx, 30*time.Second)
	enrollResp, err := client.Enroll(enrollCtx, pairing.EnrollRequest{
		Pubkey:     kp.PublicKeyHex(),
		Passphrase: passphrase,
		MachineID:  config.MachineID(),
		SystemInfo: sysMap,
	})
	enrollCancel()
	if err != nil {
		setErr(fmt.Sprintf("enroll: %v", err))
		return
	}

	s.mu.Lock()
	s.state.Phase = "waiting"
	s.state.PairCode = enrollResp.PairCode
	s.state.PairCodeShort = enrollResp.PairCodeFormatted
	s.state.Fingerprint = enrollResp.PubkeyFingerprint
	s.mu.Unlock()

	creds, err := client.WaitForClaim(ctx, func(code, formatted, expiresAt string) {
		s.mu.Lock()
		s.state.PairCode = code
		s.state.PairCodeShort = formatted
		s.mu.Unlock()
	})
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		setErr(fmt.Sprintf("waiting for claim: %v", err))
		return
	}

	if err := saveCredentials(s.configPath, panelURL, creds); err != nil {
		setErr(fmt.Sprintf("save credentials: %v", err))
		return
	}

	s.mu.Lock()
	s.state.Phase = "claimed"
	s.state.ServerName = creds.Name
	s.mu.Unlock()

	// On Windows, flip the service to auto-start and start it now that we have credentials.
	startServiceIfInstalled()
}

func saveCredentials(configPath, panelURL string, creds *pairing.Credentials) error {
	cfg, err := config.Load(configPath)
	if err != nil {
		cfg = config.Default()
	}
	wsURL := strings.TrimSuffix(panelURL, "/")
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	cfg.Server.URL = wsURL + "/agent"
	cfg.Agent.ID = creds.AgentID
	cfg.Agent.Name = creds.Name
	cfg.Auth.APIKey = creds.APIKey
	cfg.Auth.APISecret = creds.APISecret

	if configPath == "" {
		configPath = config.DefaultConfigPath()
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0700); err != nil {
		return err
	}
	if err := cfg.Save(configPath); err != nil {
		return err
	}
	return cfg.SaveCredentials()
}

// openBrowser opens the URL in the user's default browser.
func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}
