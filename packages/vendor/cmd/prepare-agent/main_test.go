package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNPMRegistryPackageVersionURL(t *testing.T) {
	got, err := npmRegistryPackageVersionURL("https://registry.npmjs.org", "@openai/codex", "0.144.0-win32-x64")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://registry.npmjs.org/@openai%2Fcodex/0.144.0-win32-x64" {
		t.Fatal(got)
	}
}
func TestNPMPackageTarballURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"dist":{"tarball":"https://registry.example/codex.tgz"}}`)
	}))
	defer server.Close()
	got, err := npmPackageTarballURL(server.Client(), server.URL, "@openai/codex", "0.144.0")
	if err != nil || got != "https://registry.example/codex.tgz" {
		t.Fatalf("%s %v", got, err)
	}
}
func TestResolvePlatformAndNativeTarget(t *testing.T) {
	for _, tt := range []struct{ platform, target string }{{"windows-x64", "x86_64-pc-windows-msvc"}, {"darwin-arm64", "aarch64-apple-darwin"}, {"linux-x64", "x86_64-unknown-linux-musl"}} {
		t.Run(tt.platform, func(t *testing.T) {
			p, err := resolvePlatform(tt.platform)
			if err != nil {
				t.Fatal(err)
			}
			got, err := codexTarget(p)
			if err != nil || got != tt.target {
				t.Fatalf("%s %v", got, err)
			}
		})
	}
	if agentBinaryName("codex", platform{OS: "windows", Arch: "x64"}) != "codex.exe" {
		t.Fatal("missing executable suffix")
	}
}
func TestSafeExtractPathRejectsTraversal(t *testing.T) {
	for _, name := range []string{"../escape", "a/../../escape", "/absolute"} {
		if _, err := safeExtractPath(t.TempDir(), name); err == nil {
			t.Fatalf("accepted %q", name)
		}
	}
}
func TestRunReusesPinnedNativeDistributionAndWritesNativeManifest(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "agents.json"), []byte(`{"codex":{"package":"@openai/codex","version":"0.144.0"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	p, err := detectPlatform()
	if err != nil {
		t.Fatal(err)
	}
	dist := filepath.Join(root, "dist", "codex")
	binary := filepath.Join("old-native", "bin", agentBinaryName("codex", p))
	if err := os.MkdirAll(filepath.Dir(filepath.Join(dist, binary)), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, binary), []byte("native-binary"), 0755); err != nil {
		t.Fatal(err)
	}
	old := agentManifest{ID: "codex", Bin: "retired-adapter", CodexBin: binary, CodexVersion: "0.144.0"}
	if err := writeManifest(dist, old); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"--root", root}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dist, "agent.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got agentManifest
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Bin != filepath.Join("runtime", "bin", agentBinaryName("codex", p)) || len(got.Args) != 0 || got.Version != "0.144.0" {
		t.Fatalf("%s", data)
	}
	if !strings.Contains(string(data), `"bin"`) {
		t.Fatal("manifest keys must remain lowercase")
	}
	if _, err := os.Stat(filepath.Join(dist, "retired-adapter")); !os.IsNotExist(err) {
		t.Fatal("adapter retained")
	}
	if err := run([]string{"--root", root}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dist, got.Bin)); err != nil {
		t.Fatal(err)
	}
	ready, err := hasPreparedAgent(dist, got)
	if err != nil || ready {
		t.Fatalf("missing native executable ready=%v err=%v", ready, err)
	}
}
func TestRunRejectsRetiredBackends(t *testing.T) {
	if err := run([]string{"--agent", "retired"}); err == nil {
		t.Fatal("must reject unsupported backend")
	}
}
