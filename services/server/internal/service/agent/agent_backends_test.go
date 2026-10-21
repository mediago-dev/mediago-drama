package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestAgentBackendServiceOnlyOffersCodex(t *testing.T) {
	s := NewAgentBackendServiceWithBinDir("", t.TempDir(), "retired-backend")
	p := s.ListBackends()
	if p.ActiveID != "codex" || len(p.Backends) != 1 || p.Backends[0].Command != "codex app-server" {
		t.Fatalf("unexpected backends: %#v", p)
	}
	if _, err := s.CodexExecutable(); err == nil {
		t.Fatal("missing bundle must fail")
	}
	if s.ActiveCommand() != "" {
		t.Fatal("must not fall back to a global executable")
	}
}
func TestAgentBackendServiceUsesNativeBinaryWithSpaces(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "MediaGo Drama Resources")
	name := "codex"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	relative := filepath.Join("runtime", "bin", name)
	path := filepath.Join(dir, "codex", relative)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("binary"), 0755); err != nil {
		t.Fatal(err)
	}
	manifest, _ := json.Marshal(agentManifest{ID: "codex", Bin: relative, CodexBin: relative, Version: "0.144.0"})
	if err := os.WriteFile(filepath.Join(dir, "codex", "agent.json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	s := NewAgentBackendServiceWithBinDir("", dir, "")
	got, err := s.CodexExecutable()
	if err != nil {
		t.Fatal(err)
	}
	if got != path || !reflect.DeepEqual(s.ActiveArgv(), []string{path}) {
		t.Fatalf("native argv: %#v", s.ActiveArgv())
	}
}
func TestAgentBackendRejectsInvalidManifestPaths(t *testing.T) {
	for _, path := range []string{"", "../outside", `..\outside`, "/absolute", `C:\outside`, "a/../../b"} {
		t.Run(path, func(t *testing.T) {
			if _, err := cleanAgentManifestPath(path); err == nil {
				t.Fatalf("accepted %q", path)
			}
		})
	}
}
func TestAgentBackendRejectsShellCommand(t *testing.T) {
	s := NewAgentBackendService("codex --dangerously-bypass-approvals-and-sandbox")
	if _, err := s.CodexExecutable(); err == nil {
		t.Fatal("configuration must be one executable path")
	}
}
