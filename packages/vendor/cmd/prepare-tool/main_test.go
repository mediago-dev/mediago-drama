package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
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

func TestCanonicalToolIDMapsXiaoyunqueToPippit(t *testing.T) {
	got := canonicalToolID(" Xiaoyunque ")
	if got != "pippit" {
		t.Fatalf("canonicalToolID() = %q, want pippit", got)
	}
}

func TestToolsJSONIncludesWindowsX64Assets(t *testing.T) {
	specs, err := loadToolSpecs(filepath.Join("..", "..", "tools.json"))
	if err != nil {
		t.Fatalf("loadToolSpecs() error = %v", err)
	}

	tests := []struct {
		id              string
		asset           string
		wantBin         string
		wantArchivePath string
	}{
		{id: "ffmpeg", asset: "ffmpeg-win32-x64", wantBin: "ffmpeg.exe"},
		{id: "ffprobe", asset: "ffprobe-win32-x64", wantBin: "ffprobe.exe"},
		{id: "libtv", asset: "libtv-windows-amd64.zip", wantBin: "libtv.exe", wantArchivePath: "libtv-win-x64/libtv.exe"},
		{id: "pippit", asset: "pippit-tool-cli-1.0.10-windows-amd64.zip", wantBin: "pippit-tool-cli.exe", wantArchivePath: "pippit-tool-cli.exe"},
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
			if got := normalizeArchivePath(platformSpec.ArchivePath); got != tt.wantArchivePath {
				t.Fatalf("win32-x64 archivePath = %q, want %q", got, tt.wantArchivePath)
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

func TestInstallDownloadedToolExtractsZipArchivePath(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "tool.zip")
	writeZipArchive(t, archivePath, "bundle/libtv", "binary")

	distDir := t.TempDir()
	err := installDownloadedTool(archivePath, toolManifest{
		ID:          "libtv",
		Bin:         "libtv",
		URL:         "https://example.test/libtv.zip",
		ArchivePath: "bundle/libtv",
	}, distDir)
	if err != nil {
		t.Fatalf("installDownloadedTool() error = %v", err)
	}
	assertPreparedBinary(t, filepath.Join(distDir, "libtv"), "binary")
}

func TestInstallDownloadedToolExtractsTarGzArchivePath(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "tool.tar.gz")
	writeTarGzArchive(t, archivePath, "pippit-tool-cli", "binary")

	distDir := t.TempDir()
	err := installDownloadedTool(archivePath, toolManifest{
		ID:          "pippit",
		Bin:         "pippit-tool-cli",
		URL:         "https://example.test/pippit.tar.gz",
		ArchivePath: "pippit-tool-cli",
	}, distDir)
	if err != nil {
		t.Fatalf("installDownloadedTool() error = %v", err)
	}
	assertPreparedBinary(t, filepath.Join(distDir, "pippit-tool-cli"), "binary")
}

func TestManifestMatchesArchivePath(t *testing.T) {
	base := toolManifest{
		ID:          "libtv",
		Bin:         "libtv",
		Version:     "1.0.2",
		Platform:    "darwin-arm64",
		URL:         "https://example.test/libtv.zip",
		ArchivePath: "bundle/libtv",
	}
	if !manifestMatches(base, base) {
		t.Fatal("manifestMatches() = false, want true")
	}
	changed := base
	changed.ArchivePath = "other/libtv"
	if manifestMatches(changed, base) {
		t.Fatal("manifestMatches() = true for different archive path, want false")
	}
}

func writeZipArchive(t *testing.T, path string, name string, contents string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create(zip) error = %v", err)
	}
	defer file.Close()
	writer := zip.NewWriter(file)
	entry, err := writer.Create(name)
	if err != nil {
		t.Fatalf("Create(entry) error = %v", err)
	}
	if _, err := entry.Write([]byte(contents)); err != nil {
		t.Fatalf("Write(entry) error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close(zip) error = %v", err)
	}
}

func writeTarGzArchive(t *testing.T, path string, name string, contents string) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create(tar.gz) error = %v", err)
	}
	defer file.Close()
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{
		Name: name,
		Mode: 0o755,
		Size: int64(len(contents)),
	}); err != nil {
		t.Fatalf("WriteHeader() error = %v", err)
	}
	if _, err := tarWriter.Write([]byte(contents)); err != nil {
		t.Fatalf("Write(tar) error = %v", err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatalf("Close(tar) error = %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("Close(gzip) error = %v", err)
	}
}

func assertPreparedBinary(t *testing.T, path string, want string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	if string(data) != want {
		t.Fatalf("binary contents = %q, want %q", string(data), want)
	}
	if err := ensureExecutable(path); err != nil {
		t.Fatalf("ensureExecutable() error = %v", err)
	}
}
