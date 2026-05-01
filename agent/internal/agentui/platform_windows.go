//go:build windows

package agentui

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// runServiceCmd issues sc.exe verb against ServerKitAgent. The MSI grants
// BUILTIN\Users start/stop/configure rights so this works as the regular
// user with no UAC prompt.
func runServiceCmd(verb string) error {
	cmd := exec.Command("sc.exe", verb, "ServerKitAgent")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("sc %s: %w (output: %s)", verb, err, string(out))
	}
	return nil
}

// waitForServiceRunning polls `sc query` until the service reports state
// 4 (RUNNING) or the deadline passes. Returns nil when running, or a
// descriptive error including the most recent state output. Used to
// verify the post-pair sc start actually took — otherwise the wizard
// silently shows "claimed" while the service quietly failed to start.
func waitForServiceRunning(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastOut string
	for time.Now().Before(deadline) {
		cmd := exec.Command("sc.exe", "query", "ServerKitAgent")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		out, err := cmd.CombinedOutput()
		lastOut = string(out)
		if err == nil && strings.Contains(lastOut, "RUNNING") {
			return nil
		}
		// STATE = 2 (START_PENDING) and 3 (STOP_PENDING) are transients —
		// just wait. STATE = 1 (STOPPED) means the service either died or
		// never came up; we'll catch it after the deadline.
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("service did not reach RUNNING within %s (last sc query: %s)",
		timeout, strings.TrimSpace(lastOut))
}

// openTarget hands a path or URL to Explorer / the default browser via
// rundll32 + url.dll, which is the canonical "open this thing" entry point
// on Windows. Faster than shelling out to cmd /c start.
func openTarget(target string) error {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

// exeForSpawn returns the path to the currently running agent binary so the
// wizard re-launch can spawn another instance of the same exe.
func exeForSpawn() (string, error) {
	return os.Executable()
}
