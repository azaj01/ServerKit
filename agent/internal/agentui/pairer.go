package agentui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/serverkit/agent/internal/logger"
	"github.com/serverkit/agent/internal/pairdriver"
)

// pairer adapts the callback-style pairdriver into a polled state machine
// the React wizard can drive over HTTP. The wizard POSTs /local/pair/start
// once with panel URL + server name; from then on it polls
// /local/pair/state every second to render the current stage and react
// to claim / error transitions.
type pairer struct {
	log        *logger.Logger
	configPath string

	mu       sync.Mutex
	state    string // "idle" | "enrolling" | "waiting" | "claimed" | "error"
	code     string
	codeFmt  string
	pass     string
	panelURL string
	server   string
	errMsg   string
	cancel   context.CancelFunc
}

func newPairer(log *logger.Logger, configPath string) *pairer {
	return &pairer{
		log:        log.WithComponent("agentui-pair"),
		configPath: configPath,
		state:      "idle",
	}
}

// register adds the wizard endpoints to the asset server's mux.
func (p *pairer) register(mux *http.ServeMux) {
	mux.HandleFunc("/local/pair/start", p.handleStart)
	mux.HandleFunc("/local/pair/state", p.handleState)
	mux.HandleFunc("/local/pair/cancel", p.handleCancel)
}

type pairStartRequest struct {
	PanelURL   string `json:"panel_url"`
	ServerName string `json:"server_name"`
}

type pairStateResponse struct {
	State          string `json:"state"`
	Code           string `json:"code,omitempty"`
	CodeFormatted  string `json:"code_formatted,omitempty"`
	Passphrase     string `json:"passphrase,omitempty"`
	PanelURL       string `json:"panel_url,omitempty"`
	ServerName     string `json:"server_name,omitempty"`
	Error          string `json:"error,omitempty"`
}

func (p *pairer) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req pairStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if req.PanelURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "panel_url is required"})
		return
	}

	pass, err := pairdriver.GeneratePassphrase()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	p.mu.Lock()
	if p.cancel != nil {
		// Replace any in-flight pairing — typical when the user edits the
		// form and re-submits.
		p.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.state = "enrolling"
	p.errMsg = ""
	p.code = ""
	p.codeFmt = ""
	p.pass = pass
	p.panelURL = req.PanelURL
	p.server = req.ServerName
	p.mu.Unlock()

	cb := pairdriver.Callbacks{
		OnEnrolled: func(code, formatted string) {
			p.mu.Lock()
			p.state = "waiting"
			p.code = code
			p.codeFmt = formatted
			p.mu.Unlock()
		},
		OnClaimed: func(serverName string) {
			p.mu.Lock()
			p.state = "claimed"
			if serverName != "" {
				p.server = serverName
			}
			p.mu.Unlock()
			// After credentials land on disk the running service still has
			// the old config in memory — restart it so the new URL/agent_id
			// take effect immediately, and verify it actually came up.
			// Earlier versions ignored sc start errors silently which is
			// why users saw "successfully paired" on a dead service and
			// had to start it manually from the CLI.
			if err := runServiceCmd("stop"); err != nil {
				p.log.Info("Service stop reported error (likely already stopped)", "error", err)
			}
			if err := runServiceCmd("start"); err != nil {
				p.log.Error("Failed to start service after pairing", "error", err)
				p.mu.Lock()
				p.state = "error"
				p.errMsg = "Pairing succeeded but the agent service failed to start: " + err.Error() +
					"\n\nTry: restart the machine, or open Actions → Restart agent."
				p.mu.Unlock()
				return
			}
			// sc start returns as soon as the SCM accepts the request, not
			// when the service is actually running. Poll for state=RUNNING
			// so the wizard's "claimed" stage reflects reality.
			if err := waitForServiceRunning(20 * time.Second); err != nil {
				p.log.Error("Service did not reach RUNNING after pairing", "error", err)
				p.mu.Lock()
				p.state = "error"
				p.errMsg = "Pairing succeeded but the agent service didn't come up within 20s. " +
					"This usually means another agent process is holding port 19780 — " +
					"try ending all serverkit-agent.exe processes from Task Manager and reopen the wizard.\n\n" +
					"Detail: " + err.Error()
				p.mu.Unlock()
				return
			}
			p.log.Info("Agent service running after pair", "server", serverName)
		},
		OnError: func(err error) {
			p.mu.Lock()
			// Cancellation isn't a "failure" the UI should surface.
			if !errors.Is(err, context.Canceled) {
				p.state = "error"
				p.errMsg = err.Error()
			}
			p.mu.Unlock()
		},
	}

	go pairdriver.Run(ctx, p.log, p.configPath, req.PanelURL, pass, req.ServerName, cb)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (p *pairer) handleState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p.mu.Lock()
	resp := pairStateResponse{
		State:         p.state,
		Code:          p.code,
		CodeFormatted: p.codeFmt,
		Passphrase:    p.pass,
		PanelURL:      p.panelURL,
		ServerName:    p.server,
		Error:         p.errMsg,
	}
	p.mu.Unlock()
	writeJSON(w, http.StatusOK, resp)
}

func (p *pairer) handleCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p.mu.Lock()
	if p.cancel != nil {
		p.cancel()
	}
	p.state = "idle"
	p.code = ""
	p.codeFmt = ""
	p.pass = ""
	p.errMsg = ""
	p.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
