package agent

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestAgentBackendServiceDefaultsToCodex(t *testing.T) {
	store := NewAgentBackendService("")

	payload := store.ListBackends()
	if payload.ActiveID != "codex" {
		t.Fatalf("ActiveID = %q, want codex", payload.ActiveID)
	}
	if len(payload.Backends) != 2 {
		t.Fatalf("len(Backends) = %d, want 2", len(payload.Backends))
	}
	if command := store.ActiveCommand(); command != "codex-acp" {
		t.Fatalf("ActiveCommand() = %q, want codex-acp", command)
	}
	assertArgv(t, store.ActiveArgv(), []string{"codex-acp"})
}

func TestAgentBackendServiceMatchesInitialBuiltinCommand(t *testing.T) {
	store := NewAgentBackendService("  opencode   acp  ")

	payload := store.ListBackends()
	if payload.ActiveID != "opencode" {
		t.Fatalf("ActiveID = %q, want opencode", payload.ActiveID)
	}
	if command := store.ActiveCommand(); command != "opencode acp" {
		t.Fatalf("ActiveCommand() = %q, want opencode command", command)
	}
	assertArgv(t, store.ActiveArgv(), []string{"opencode", "acp"})
}

func TestAgentBackendServiceKeepsCustomInitialCommand(t *testing.T) {
	store := NewAgentBackendService("custom-acp --profile local")

	payload := store.ListBackends()
	if payload.ActiveID != "custom" {
		t.Fatalf("ActiveID = %q, want custom", payload.ActiveID)
	}
	if len(payload.Backends) != 3 {
		t.Fatalf("len(Backends) = %d, want 3", len(payload.Backends))
	}
	if command := store.ActiveCommand(); command != "custom-acp --profile local" {
		t.Fatalf("ActiveCommand() = %q, want custom command", command)
	}
	assertArgv(t, store.ActiveArgv(), []string{"custom-acp", "--profile", "local"})
}

func TestAgentBackendServiceUsesInitialActiveBackendID(t *testing.T) {
	store := NewAgentBackendServiceWithBinDir("", "", "opencode")

	payload := store.ListBackends()
	if payload.ActiveID != "opencode" {
		t.Fatalf("ActiveID = %q, want opencode", payload.ActiveID)
	}
	assertArgv(t, store.ActiveArgv(), []string{"opencode", "acp"})
}

func TestAgentBackendServiceFallsBackWhenManifestMissing(t *testing.T) {
	binDir := filepath.Join(t.TempDir(), "agent dist")
	store := NewAgentBackendServiceWithBinDir("", binDir, "opencode")

	assertArgv(t, store.ActiveArgv(), []string{"opencode", "acp"})
}

func TestAgentBackendServiceReadsVendoredManifest(t *testing.T) {
	binDir := filepath.Join(t.TempDir(), "agent dist")
	agentDir := filepath.Join(binDir, "opencode")
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	manifest := `{"id":"opencode","bin":"opencode","args":["acp"],"version":"v1.2.3"}`
	if err := os.WriteFile(filepath.Join(agentDir, "agent.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	store := NewAgentBackendServiceWithBinDir("", binDir, "opencode")

	assertArgv(t, store.ActiveArgv(), []string{filepath.Join(binDir, "opencode", "opencode"), "acp"})
}

func TestAgentBackendServiceKeepsSpacesInsideVendoredExecutablePath(t *testing.T) {
	binDir := filepath.Join(t.TempDir(), "MediaGo Drama Resources")
	agentDir := filepath.Join(binDir, "codex")
	if err := os.MkdirAll(agentDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	manifest := `{"id":"codex","bin":"codex-acp","args":[],"version":"v0.15.0"}`
	if err := os.WriteFile(filepath.Join(agentDir, "agent.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	store := NewAgentBackendServiceWithBinDir("", binDir, "codex")
	argv := store.ActiveArgv()

	assertArgv(t, argv, []string{filepath.Join(binDir, "codex", "codex-acp")})
	if len(argv) != 1 {
		t.Fatalf("len(ActiveArgv()) = %d, want 1", len(argv))
	}
}

func assertArgv(t *testing.T, got []string, want []string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ActiveArgv() = %#v, want %#v", got, want)
	}
}
