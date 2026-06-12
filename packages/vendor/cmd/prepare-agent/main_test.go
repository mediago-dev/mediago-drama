package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReleaseAssetName(t *testing.T) {
	tests := []struct {
		name     string
		agentID  string
		tag      string
		platform platform
		want     string
	}{
		{
			name:     "codex darwin arm64",
			agentID:  "codex",
			tag:      "v0.15.0",
			platform: platform{OS: "darwin", Arch: "arm64"},
			want:     "codex-acp-0.15.0-aarch64-apple-darwin.tar.gz",
		},
		{
			name:     "codex linux x64",
			agentID:  "codex",
			tag:      "v0.15.0",
			platform: platform{OS: "linux", Arch: "x64"},
			want:     "codex-acp-0.15.0-x86_64-unknown-linux-gnu.tar.gz",
		},
		{
			name:     "opencode darwin arm64",
			agentID:  "opencode",
			tag:      "v1.15.13",
			platform: platform{OS: "darwin", Arch: "arm64"},
			want:     "opencode-darwin-arm64.zip",
		},
		{
			name:     "opencode linux x64",
			agentID:  "opencode",
			tag:      "v1.15.13",
			platform: platform{OS: "linux", Arch: "x64"},
			want:     "opencode-linux-x64.tar.gz",
		},
		{
			name:     "opencode windows x64",
			agentID:  "opencode",
			tag:      "v1.15.13",
			platform: platform{OS: "windows", Arch: "x64"},
			want:     "opencode-windows-x64.zip",
		},
		{
			name:     "opencode windows arm64",
			agentID:  "opencode",
			tag:      "v1.15.13",
			platform: platform{OS: "windows", Arch: "arm64"},
			want:     "opencode-windows-arm64.zip",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := releaseAssetName(tt.agentID, tt.tag, tt.platform)
			if err != nil {
				t.Fatalf("releaseAssetName() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("releaseAssetName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAgentBinaryNameUsesExeOnWindows(t *testing.T) {
	got := agentBinaryName("opencode", platform{OS: "windows", Arch: "x64"})
	if got != "opencode.exe" {
		t.Fatalf("agentBinaryName() = %q, want opencode.exe", got)
	}
}

func TestSafeExtractPathRejectsTraversal(t *testing.T) {
	if _, err := safeExtractPath(t.TempDir(), "../escape"); err == nil {
		t.Fatalf("safeExtractPath() error = nil, want traversal error")
	}
}

func TestHasPreparedAgent(t *testing.T) {
	distDir := t.TempDir()
	expected := agentManifest{ID: "opencode", Bin: "opencode", Args: []string{"acp"}, Version: "v1.15.13"}
	if err := os.WriteFile(filepath.Join(distDir, "agent.json"), []byte(`{"id":"opencode","bin":"opencode","args":["acp"],"version":"v1.15.13"}`), 0o644); err != nil {
		t.Fatalf("WriteFile(agent.json) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "opencode"), []byte("binary"), 0o755); err != nil {
		t.Fatalf("WriteFile(binary) error = %v", err)
	}

	cached, err := hasPreparedAgent(distDir, expected)
	if err != nil {
		t.Fatalf("hasPreparedAgent() error = %v", err)
	}
	if !cached {
		t.Fatalf("hasPreparedAgent() = false, want true")
	}
}

func TestHasPreparedAgentRejectsDifferentVersion(t *testing.T) {
	distDir := t.TempDir()
	expected := agentManifest{ID: "codex", Bin: "codex-acp", Version: "v0.15.0"}
	if err := os.WriteFile(filepath.Join(distDir, "agent.json"), []byte(`{"id":"codex","bin":"codex-acp","args":[],"version":"v0.14.0"}`), 0o644); err != nil {
		t.Fatalf("WriteFile(agent.json) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "codex-acp"), []byte("binary"), 0o755); err != nil {
		t.Fatalf("WriteFile(binary) error = %v", err)
	}

	cached, err := hasPreparedAgent(distDir, expected)
	if err != nil {
		t.Fatalf("hasPreparedAgent() error = %v", err)
	}
	if cached {
		t.Fatalf("hasPreparedAgent() = true, want false")
	}
}
