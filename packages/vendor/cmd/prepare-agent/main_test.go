package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNPMRegistryPackageVersionURL(t *testing.T) {
	got, err := npmRegistryPackageVersionURL("https://registry.npmjs.org", "@agentclientprotocol/codex-acp", "1.1.2")
	if err != nil {
		t.Fatalf("npmRegistryPackageVersionURL() error = %v", err)
	}
	want := "https://registry.npmjs.org/@agentclientprotocol%2Fcodex-acp/1.1.2"
	if got != want {
		t.Fatalf("npmRegistryPackageVersionURL() = %q, want %q", got, want)
	}
}

func TestNPMPackageTarballURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.EscapedPath() != "/@agentclientprotocol%2Fcodex-acp/1.1.2" {
			t.Fatalf("metadata path = %q", request.URL.EscapedPath())
		}
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"dist":{"tarball":"https://registry.example/codex-acp-1.1.2.tgz"}}`)
	}))
	defer server.Close()

	got, err := npmPackageTarballURL(server.Client(), server.URL, "@agentclientprotocol/codex-acp", "1.1.2")
	if err != nil {
		t.Fatalf("npmPackageTarballURL() error = %v", err)
	}
	if got != "https://registry.example/codex-acp-1.1.2.tgz" {
		t.Fatalf("npmPackageTarballURL() = %q", got)
	}
}

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
			tag:      "v0.16.0",
			platform: platform{OS: "darwin", Arch: "arm64"},
			want:     "codex-acp-0.16.0-aarch64-apple-darwin.tar.gz",
		},
		{
			name:     "codex linux x64",
			agentID:  "codex",
			tag:      "v0.16.0",
			platform: platform{OS: "linux", Arch: "x64"},
			want:     "codex-acp-0.16.0-x86_64-unknown-linux-gnu.tar.gz",
		},
		{
			name:     "codex windows x64",
			agentID:  "codex",
			tag:      "v0.16.0",
			platform: platform{OS: "windows", Arch: "x64"},
			want:     "codex-acp-0.16.0-x86_64-pc-windows-msvc.zip",
		},
		{
			name:     "codex windows arm64",
			agentID:  "codex",
			tag:      "v0.16.0",
			platform: platform{OS: "windows", Arch: "arm64"},
			want:     "codex-acp-0.16.0-aarch64-pc-windows-msvc.zip",
		},
		{
			name:     "opencode darwin arm64",
			agentID:  "opencode",
			tag:      "v1.17.11",
			platform: platform{OS: "darwin", Arch: "arm64"},
			want:     "opencode-darwin-arm64.zip",
		},
		{
			name:     "opencode linux x64",
			agentID:  "opencode",
			tag:      "v1.17.11",
			platform: platform{OS: "linux", Arch: "x64"},
			want:     "opencode-linux-x64.tar.gz",
		},
		{
			name:     "opencode windows x64",
			agentID:  "opencode",
			tag:      "v1.17.11",
			platform: platform{OS: "windows", Arch: "x64"},
			want:     "opencode-windows-x64.zip",
		},
		{
			name:     "opencode windows arm64",
			agentID:  "opencode",
			tag:      "v1.17.11",
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

func TestCodexNPMBundlePlatform(t *testing.T) {
	tests := []struct {
		name             string
		platform         platform
		wantBunTarget    string
		wantCodexVersion string
		wantCodexTarget  string
		wantCodexBin     string
	}{
		{
			name:             "darwin arm64",
			platform:         platform{OS: "darwin", Arch: "arm64"},
			wantBunTarget:    "bun-darwin-arm64",
			wantCodexVersion: "0.144.0-darwin-arm64",
			wantCodexTarget:  "aarch64-apple-darwin",
			wantCodexBin:     filepath.Join("codex", "vendor", "aarch64-apple-darwin", "bin", "codex"),
		},
		{
			name:             "windows x64",
			platform:         platform{OS: "windows", Arch: "x64"},
			wantBunTarget:    "bun-windows-x64-baseline",
			wantCodexVersion: "0.144.0-win32-x64",
			wantCodexTarget:  "x86_64-pc-windows-msvc",
			wantCodexBin:     filepath.Join("codex", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
		},
		{
			name:             "linux x64",
			platform:         platform{OS: "linux", Arch: "x64"},
			wantBunTarget:    "bun-linux-x64-baseline",
			wantCodexVersion: "0.144.0-linux-x64",
			wantCodexTarget:  "x86_64-unknown-linux-musl",
			wantCodexBin:     filepath.Join("codex", "vendor", "x86_64-unknown-linux-musl", "bin", "codex"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := codexNPMBundlePlatform(tt.platform, "0.144.0")
			if err != nil {
				t.Fatalf("codexNPMBundlePlatform() error = %v", err)
			}
			if got.BunTarget != tt.wantBunTarget ||
				got.CodexPackageVersion != tt.wantCodexVersion ||
				got.CodexTarget != tt.wantCodexTarget ||
				got.CodexBin != tt.wantCodexBin {
				t.Fatalf("codexNPMBundlePlatform() = %#v", got)
			}
		})
	}
}

func TestLoadAgentSpecsReadsNPMBundleMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agents.json")
	raw := `{"codex":{"distribution":"npm-bundle","package":"@agentclientprotocol/codex-acp","bin":"codex-acp","version":"1.1.2","codexPackage":"@openai/codex","codexVersion":"0.144.0","bunVersion":"1.3.14"}}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	specs, err := loadAgentSpecs(path)
	if err != nil {
		t.Fatalf("loadAgentSpecs() error = %v", err)
	}
	got := specs["codex"]
	if got.Distribution != "npm-bundle" ||
		got.Package != "@agentclientprotocol/codex-acp" ||
		got.Version != "1.1.2" ||
		got.CodexPackage != "@openai/codex" ||
		got.CodexVersion != "0.144.0" ||
		got.BunVersion != "1.3.14" {
		t.Fatalf("codex spec = %#v", got)
	}
}

func TestAgentBinaryNameUsesExeOnWindows(t *testing.T) {
	got := agentBinaryName("opencode", platform{OS: "windows", Arch: "x64"})
	if got != "opencode.exe" {
		t.Fatalf("agentBinaryName() = %q, want opencode.exe", got)
	}
}

func TestResolvePlatformNormalizesWindows(t *testing.T) {
	got, err := resolvePlatform("windows-x64")
	if err != nil {
		t.Fatalf("resolvePlatform() error = %v", err)
	}
	want := platform{OS: "windows", Arch: "x64"}
	if got != want {
		t.Fatalf("resolvePlatform() = %#v, want %#v", got, want)
	}
	if got.String() != "windows-x64" {
		t.Fatalf("platform.String() = %q, want windows-x64", got.String())
	}
}

func TestSafeExtractPathRejectsTraversal(t *testing.T) {
	if _, err := safeExtractPath(t.TempDir(), "../escape"); err == nil {
		t.Fatalf("safeExtractPath() error = nil, want traversal error")
	}
}

func TestHasPreparedAgent(t *testing.T) {
	distDir := t.TempDir()
	expected := agentManifest{ID: "opencode", Bin: "opencode", Args: []string{"acp"}, Version: "v1.17.11"}
	if err := os.WriteFile(filepath.Join(distDir, "agent.json"), []byte(`{"id":"opencode","bin":"opencode","args":["acp"],"version":"v1.17.11"}`), 0o644); err != nil {
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
	expected := agentManifest{ID: "codex", Bin: "codex-acp", Version: "1.1.2"}
	if err := os.WriteFile(filepath.Join(distDir, "agent.json"), []byte(`{"id":"codex","bin":"codex-acp","args":[],"version":"1.1.1"}`), 0o644); err != nil {
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

func TestHasPreparedAgentRequiresCodexCompanion(t *testing.T) {
	distDir := t.TempDir()
	expected := agentManifest{
		ID:           "codex",
		Bin:          "codex-acp",
		Version:      "1.1.2",
		CodexBin:     filepath.Join("codex", "vendor", "aarch64-apple-darwin", "bin", "codex"),
		CodexVersion: "0.144.0",
	}
	raw := `{"id":"codex","bin":"codex-acp","args":[],"version":"1.1.2","codexBin":"codex/vendor/aarch64-apple-darwin/bin/codex","codexVersion":"0.144.0"}`
	if err := os.WriteFile(filepath.Join(distDir, "agent.json"), []byte(raw), 0o644); err != nil {
		t.Fatalf("WriteFile(agent.json) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "codex-acp"), []byte("binary"), 0o755); err != nil {
		t.Fatalf("WriteFile(codex-acp) error = %v", err)
	}

	cached, err := hasPreparedAgent(distDir, expected)
	if err != nil {
		t.Fatalf("hasPreparedAgent() error = %v", err)
	}
	if cached {
		t.Fatal("hasPreparedAgent() = true without Codex companion")
	}

	codexPath := filepath.Join(distDir, expected.CodexBin)
	if err := os.MkdirAll(filepath.Dir(codexPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(codexPath, []byte("codex"), 0o755); err != nil {
		t.Fatalf("WriteFile(codex) error = %v", err)
	}
	cached, err = hasPreparedAgent(distDir, expected)
	if err != nil || !cached {
		t.Fatalf("hasPreparedAgent() = %v, %v; want true", cached, err)
	}
}
