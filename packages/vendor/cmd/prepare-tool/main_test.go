package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlatformString(t *testing.T) {
	got := (platform{OS: "darwin", Arch: "arm64"}).String()
	if got != "darwin-arm64" {
		t.Fatalf("platform.String() = %q, want darwin-arm64", got)
	}
}

func TestResolvePlatformMapsWindowsToWin32Assets(t *testing.T) {
	got, distKey, err := resolvePlatform("windows-x64")
	if err != nil {
		t.Fatalf("resolvePlatform() error = %v", err)
	}
	want := platform{OS: "win32", Arch: "x64"}
	if got != want {
		t.Fatalf("resolvePlatform() = %#v, want %#v", got, want)
	}
	if got.String() != "win32-x64" {
		t.Fatalf("platform.String() = %q, want win32-x64", got.String())
	}
	if distKey != "windows-x64" {
		t.Fatalf("distKey = %q, want windows-x64", distKey)
	}
}

func TestToolBinaryNameUsesExeOnWindows(t *testing.T) {
	got := toolBinaryName("ffmpeg", "win32-x64")
	if got != "ffmpeg.exe" {
		t.Fatalf("toolBinaryName() = %q, want ffmpeg.exe", got)
	}
}

func TestToolsJSONIncludesWindowsX64Assets(t *testing.T) {
	specs, err := loadToolSpecs(filepath.Join("..", "..", "tools.json"))
	if err != nil {
		t.Fatalf("loadToolSpecs() error = %v", err)
	}

	tests := []struct {
		id      string
		asset   string
		wantBin string
	}{
		{id: "ffmpeg", asset: "ffmpeg-win32-x64", wantBin: "ffmpeg.exe"},
		{id: "ffprobe", asset: "ffprobe-win32-x64", wantBin: "ffprobe.exe"},
	}
	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			spec, ok := specs[tt.id]
			if !ok {
				t.Fatalf("missing tool spec %q", tt.id)
			}
			platformSpec, ok := spec.Platforms["win32-x64"]
			if !ok {
				t.Fatalf("missing win32-x64 platform for %q", tt.id)
			}
			if !strings.Contains(platformSpec.URL, tt.asset) {
				t.Fatalf("win32-x64 url = %q, want asset %q", platformSpec.URL, tt.asset)
			}
			if platformSpec.SizeBytes <= 0 {
				t.Fatalf("win32-x64 sizeBytes = %d, want positive value", platformSpec.SizeBytes)
			}
			if got := toolBinaryName(spec.Bin, "win32-x64"); got != tt.wantBin {
				t.Fatalf("toolBinaryName() = %q, want %q", got, tt.wantBin)
			}
		})
	}
}

func TestHasPreparedTool(t *testing.T) {
	distDir := t.TempDir()
	expected := toolManifest{
		ID:        "ffmpeg",
		Bin:       "ffmpeg",
		Version:   "b6.1.2-rc.1",
		Platform:  "darwin-arm64",
		URL:       "https://example.test/ffmpeg",
		SizeBytes: 12,
	}
	if err := os.WriteFile(filepath.Join(distDir, "tool.json"), []byte(`{"id":"ffmpeg","bin":"ffmpeg","version":"b6.1.2-rc.1","platform":"darwin-arm64","url":"https://example.test/ffmpeg","sizeBytes":12}`), 0o644); err != nil {
		t.Fatalf("WriteFile(tool.json) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "ffmpeg"), []byte("binary"), 0o755); err != nil {
		t.Fatalf("WriteFile(binary) error = %v", err)
	}

	cached, err := hasPreparedTool(distDir, expected)
	if err != nil {
		t.Fatalf("hasPreparedTool() error = %v", err)
	}
	if !cached {
		t.Fatalf("hasPreparedTool() = false, want true")
	}
}

func TestHasPreparedToolRejectsDifferentURL(t *testing.T) {
	distDir := t.TempDir()
	expected := toolManifest{
		ID:       "ffmpeg",
		Bin:      "ffmpeg",
		Version:  "b6.1.2-rc.1",
		Platform: "darwin-arm64",
		URL:      "https://example.test/new-ffmpeg",
	}
	if err := os.WriteFile(filepath.Join(distDir, "tool.json"), []byte(`{"id":"ffmpeg","bin":"ffmpeg","version":"b6.1.2-rc.1","platform":"darwin-arm64","url":"https://example.test/old-ffmpeg"}`), 0o644); err != nil {
		t.Fatalf("WriteFile(tool.json) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(distDir, "ffmpeg"), []byte("binary"), 0o755); err != nil {
		t.Fatalf("WriteFile(binary) error = %v", err)
	}

	cached, err := hasPreparedTool(distDir, expected)
	if err != nil {
		t.Fatalf("hasPreparedTool() error = %v", err)
	}
	if cached {
		t.Fatalf("hasPreparedTool() = true, want false")
	}
}

func TestVerifyDownloadedToolChecksSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(path, []byte("1234"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	err := verifyDownloadedTool(path, toolManifest{SizeBytes: 8})
	if err == nil {
		t.Fatal("verifyDownloadedTool() error = nil, want size mismatch")
	}
}
