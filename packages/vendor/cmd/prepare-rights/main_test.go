package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunSkipsWhenProtectedRuntimeIsNotIncluded(t *testing.T) {
	t.Setenv(includeRuntimeEnv, "")
	t.Setenv(privateTokenEnv, "")
	t.Setenv(releaseTagEnv, "")
	if err := run(nil); err != nil {
		t.Fatalf("run() error = %v, want nil", err)
	}
}

func TestRunRequiresReleaseTagWhenIncluded(t *testing.T) {
	t.Setenv(includeRuntimeEnv, "1")
	t.Setenv(privateTokenEnv, "token")
	t.Setenv(releaseTagEnv, "")
	err := run([]string{"--platform", "darwin-arm64", "--root", t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), releaseTagEnv) {
		t.Fatalf("run() error = %v, want missing release tag", err)
	}
}

func TestResolveTargetMapsWindowsManifestAndBinary(t *testing.T) {
	got, explicit, err := resolveTarget("windows-x64")
	if err != nil {
		t.Fatalf("resolveTarget() error = %v", err)
	}
	if !explicit || got.ManifestKey != "win32-x64" || got.BinaryName != "mediago-rights.exe" {
		t.Fatalf("resolveTarget() = %#v, explicit %t", got, explicit)
	}
}

func TestFindReleaseAssetRequiresExactName(t *testing.T) {
	value := release{Assets: []releaseAsset{{Name: manifestAssetName, URL: "https://api.github.com/assets/1"}}}
	if _, err := findReleaseAsset(value, manifestAssetName); err != nil {
		t.Fatalf("findReleaseAsset() error = %v", err)
	}
	if _, err := findReleaseAsset(value, "missing.zip"); err == nil {
		t.Fatal("findReleaseAsset() error = nil, want missing asset error")
	}
}

func TestParseExpectedManifestValidatesPinnedMetadata(t *testing.T) {
	target, _, err := resolveTarget("darwin-arm64")
	if err != nil {
		t.Fatal(err)
	}
	raw := manifestJSON(t, "v1.2.3", target, 42, strings.Repeat("a", 64))
	got, err := parseExpectedManifest(raw, "v1.2.3", target)
	if err != nil {
		t.Fatalf("parseExpectedManifest() error = %v", err)
	}
	if got.Bin != "mediago-rights" || got.Policy != "marketplace" || got.SizeBytes != 42 {
		t.Fatalf("parseExpectedManifest() = %#v", got)
	}

	var manifest privateToolsManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	tool := manifest["mediago-rights"]
	platform := tool.Platforms[target.ManifestKey]
	platform.URL = "http://github.com/insecure.zip"
	tool.Platforms[target.ManifestKey] = platform
	manifest["mediago-rights"] = tool
	insecure, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseExpectedManifest(insecure, "v1.2.3", target); err == nil {
		t.Fatal("parseExpectedManifest() error = nil, want insecure URL error")
	}
}

func TestVerifyAndStageArchive(t *testing.T) {
	target, _, err := resolveTarget("darwin-arm64")
	if err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(t.TempDir(), target.ArchiveAsset)
	writeZip(t, archivePath, target.BinaryName, []byte("runtime-binary"))
	raw, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	expected := stagedManifest{
		ID:          "mediago-rights",
		Bin:         target.BinaryName,
		Version:     "v1.2.3",
		Policy:      "marketplace",
		Platform:    target.ManifestKey,
		URL:         "https://github.com/mediago-dev/mediago-drama-private/releases/download/v1.2.3/runtime.zip",
		ArchivePath: target.BinaryName,
		SizeBytes:   int64(len(raw)),
		SHA256:      hex.EncodeToString(digest[:]),
	}
	if err := verifyArchive(archivePath, expected); err != nil {
		t.Fatalf("verifyArchive() error = %v", err)
	}
	distDir := filepath.Join(t.TempDir(), "tools", "mediago-rights")
	if err := stageArchive(archivePath, distDir, &expected); err != nil {
		t.Fatalf("stageArchive() error = %v", err)
	}
	got, err := os.ReadFile(filepath.Join(distDir, target.BinaryName))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "runtime-binary" {
		t.Fatalf("staged binary = %q", got)
	}
	cached, err := hasPreparedRuntime(distDir, expected)
	if err != nil {
		t.Fatalf("hasPreparedRuntime() error = %v", err)
	}
	if !cached {
		t.Fatal("hasPreparedRuntime() = false, want true")
	}
}

func TestPreparerDownloadsReleaseAssetsAndReusesCache(t *testing.T) {
	target, _, err := resolveTarget("darwin-arm64")
	if err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(t.TempDir(), target.ArchiveAsset)
	writeZip(t, archivePath, target.BinaryName, []byte("runtime-binary"))
	archive, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(archive)
	manifest := manifestJSON(t, "v1.2.3", target, int64(len(archive)), hex.EncodeToString(digest[:]))

	archiveDownloads := 0
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer secret" {
			return testResponse(http.StatusUnauthorized, []byte("unauthorized")), nil
		}
		switch request.URL.Path {
		case "/repos/" + privateRepository + "/releases/tags/v1.2.3":
			if request.Header.Get("Accept") != "application/vnd.github+json" {
				t.Errorf("release Accept = %q", request.Header.Get("Accept"))
			}
			raw, err := json.Marshal(release{Assets: []releaseAsset{
				{Name: manifestAssetName, URL: "https://api.github.com/assets/manifest"},
				{Name: target.ArchiveAsset, URL: "https://api.github.com/assets/archive"},
			}})
			if err != nil {
				return nil, err
			}
			return testResponse(http.StatusOK, raw), nil
		case "/assets/manifest":
			return testResponse(http.StatusOK, manifest), nil
		case "/assets/archive":
			archiveDownloads++
			return testResponse(http.StatusOK, archive), nil
		default:
			return testResponse(http.StatusNotFound, nil), nil
		}
	})}

	worker := preparer{client: client, apiBase: githubAPIBase, token: "secret"}
	distDir := filepath.Join(t.TempDir(), "tools", "mediago-rights")
	for range 2 {
		if err := worker.prepare(context.Background(), "v1.2.3", target, distDir); err != nil {
			t.Fatalf("prepare() error = %v", err)
		}
	}
	if archiveDownloads != 1 {
		t.Fatalf("archive downloads = %d, want 1", archiveDownloads)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func testResponse(status int, body []byte) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Body:       io.NopCloser(bytes.NewReader(body)),
		Header:     make(http.Header),
	}
}

func TestStageArchiveRejectsUnexpectedEntries(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "runtime.zip")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for _, name := range []string{"mediago-rights", "extra.txt"} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	expected := stagedManifest{Bin: "mediago-rights", ArchivePath: "mediago-rights"}
	if err := stageArchive(archivePath, t.TempDir(), &expected); err == nil {
		t.Fatal("stageArchive() error = nil, want invalid entries error")
	}
}

func manifestJSON(t *testing.T, version string, target target, size int64, digest string) []byte {
	t.Helper()
	manifest := privateToolsManifest{
		"mediago-rights": {
			Bin:     "mediago-rights",
			Version: version,
			Policy:  "marketplace",
			Platforms: map[string]privateToolPlatformSpec{
				target.ManifestKey: {
					URL:         "https://github.com/mediago-dev/mediago-drama-private/releases/download/" + version + "/" + target.ArchiveAsset,
					ArchivePath: target.BinaryName,
					SizeBytes:   size,
					SHA256:      digest,
				},
			},
		},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func writeZip(t *testing.T, path string, name string, contents []byte) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	header := &zip.FileHeader{Name: name, Method: zip.Store}
	entry, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bytes.NewReader(contents).WriteTo(entry); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}
