package main

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	serverconfig "github.com/mediago-dev/mediago-drama/services/server/internal/config"
)

func TestRunRejectsUninitializedWorkspaceBeforeServing(t *testing.T) {
	root := t.TempDir()
	blocked := filepath.Join(root, "blocked")
	if err := os.WriteFile(blocked, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	// An occupied port also bounds the regression case where startup ignores readiness.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	listener.Close()
	workspaceDir := filepath.Join(blocked, "workspace")
	raw, err := json.Marshal(map[string]any{
		"workspace_dir": workspaceDir,
		"log_path":      filepath.Join(root, "server.log"),
		"port":          listener.Addr().(*net.TCPAddr).Port,
	})
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "server.yaml")
	if err := os.WriteFile(configPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEX_HOME", "")
	t.Setenv("MEDIAGO_WORKSPACE_DIR", "")
	t.Setenv("MEDIAGO_SERVER_PORT", "")
	t.Setenv("MEDIAGO_SIDECAR_MODE", "0")
	t.Setenv("ONE_INTERNAL_API_URL", "")
	t.Setenv("ONE_INTERNAL_API_TOKEN", "")
	err = run([]string{"--config", configPath})
	if err == nil || !strings.Contains(err.Error(), "initializing workspace") || !strings.Contains(err.Error(), "app.db") {
		t.Fatalf("run() error = %v, want workspace initialization failure with database path", err)
	}
}

func TestApplyEnvOverrides(t *testing.T) {
	t.Setenv("MEDIAGO_AGENT_ID", "opencode")
	t.Setenv("MEDIAGO_AGENT_BIN_DIR", "/tmp/agents")
	t.Setenv("MEDIAGO_FFMPEG_PATH", "/tmp/ffmpeg")
	t.Setenv("MEDIAGO_FFMPEG_BIN_DIR", "/tmp/tools/ffmpeg")
	t.Setenv("MEDIAGO_JIMENG_PATH", "/tmp/dreamina")
	t.Setenv("MEDIAGO_JIMENG_BIN_DIR", "/tmp/tools")
	t.Setenv("MEDIAGO_LIBTV_PATH", "/tmp/libtv")
	t.Setenv("MEDIAGO_LIBTV_BIN_DIR", "/tmp/tools/libtv")
	t.Setenv("MEDIAGO_LIBTV_PROJECT_ID", "project-env-123")
	t.Setenv("MEDIAGO_SERVER_PORT", "48273")
	t.Setenv("MEDIAGO_LOG_LEVEL", "debug")
	t.Setenv("MEDIAGO_MODEL_PLATFORM", "openrouter")
	t.Setenv("MEDIAGO_GENERATION_CLIS", "jimeng,libtv")

	config := serverconfig.ServerConfig{Port: 8080}
	if err := applyEnvOverrides(&config); err != nil {
		t.Fatalf("applyEnvOverrides returned error: %v", err)
	}

	if config.Agent.ID != "opencode" {
		t.Fatalf("Agent.ID = %q, want %q", config.Agent.ID, "opencode")
	}
	if config.Agent.BinDir != "/tmp/agents" {
		t.Fatalf("Agent.BinDir = %q, want %q", config.Agent.BinDir, "/tmp/agents")
	}
	if config.FFmpeg.Path != "/tmp/ffmpeg" {
		t.Fatalf("FFmpeg.Path = %q, want %q", config.FFmpeg.Path, "/tmp/ffmpeg")
	}
	if config.FFmpeg.BinDir != "/tmp/tools/ffmpeg" {
		t.Fatalf("FFmpeg.BinDir = %q, want %q", config.FFmpeg.BinDir, "/tmp/tools/ffmpeg")
	}
	if config.Jimeng.Path != "/tmp/dreamina" {
		t.Fatalf("Jimeng.Path = %q, want %q", config.Jimeng.Path, "/tmp/dreamina")
	}
	if config.Jimeng.BinDir != "/tmp/tools" {
		t.Fatalf("Jimeng.BinDir = %q, want %q", config.Jimeng.BinDir, "/tmp/tools")
	}
	if config.LibTV.Path != "/tmp/libtv" {
		t.Fatalf("LibTV.Path = %q, want %q", config.LibTV.Path, "/tmp/libtv")
	}
	if config.LibTV.BinDir != "/tmp/tools/libtv" {
		t.Fatalf("LibTV.BinDir = %q, want %q", config.LibTV.BinDir, "/tmp/tools/libtv")
	}
	if config.LibTV.ProjectID != "project-env-123" {
		t.Fatalf("LibTV.ProjectID = %q, want %q", config.LibTV.ProjectID, "project-env-123")
	}

	if config.Port != 48273 {
		t.Fatalf("Port = %d, want %d", config.Port, 48273)
	}
	if config.LogLevel != "debug" {
		t.Fatalf("LogLevel = %q, want debug", config.LogLevel)
	}
	if got := strings.Join(config.ModelPlatforms, ","); got != "openrouter" {
		t.Fatalf("ModelPlatforms = %q, want openrouter", got)
	}
	if got := strings.Join(config.GenerationCLIs, ","); got != "jimeng,libtv" {
		t.Fatalf("GenerationCLIs = %q, want jimeng,libtv", got)
	}

}

func TestApplyEnvOverridesRejectsInvalidServerPort(t *testing.T) {
	t.Setenv("MEDIAGO_SERVER_PORT", "70000")

	config := serverconfig.ServerConfig{Port: 8080}
	if err := applyEnvOverrides(&config); err == nil {
		t.Fatal("applyEnvOverrides returned nil error, want invalid port error")
	}
}

func TestApplyEnvOverridesRejectsInvalidModelPlatform(t *testing.T) {
	t.Setenv("MEDIAGO_MODEL_PLATFORM", "auto")

	config := serverconfig.ServerConfig{}
	if err := applyEnvOverrides(&config); err == nil {
		t.Fatal("applyEnvOverrides returned nil error, want invalid model platform error")
	}
}

func TestApplyEnvOverridesRejectsInvalidGenerationCLI(t *testing.T) {
	t.Setenv("MEDIAGO_GENERATION_CLIS", "auto")

	config := serverconfig.ServerConfig{}
	if err := applyEnvOverrides(&config); err == nil {
		t.Fatal("applyEnvOverrides returned nil error, want invalid generation CLI error")
	}
}

func TestApplySidecarDefaultsForcesLoopback(t *testing.T) {
	t.Setenv("MEDIAGO_SIDECAR_MODE", "1")
	config := serverconfig.ServerConfig{Host: "0.0.0.0"}

	applySidecarDefaults(&config)

	if config.Host != "127.0.0.1" {
		t.Fatalf("Host = %q, want loopback", config.Host)
	}
}

func TestApplySidecarDefaultsLeavesStandaloneHostUnchanged(t *testing.T) {
	config := serverconfig.ServerConfig{Host: "0.0.0.0"}

	applySidecarDefaults(&config)

	if config.Host != "0.0.0.0" {
		t.Fatalf("Host = %q, want standalone host unchanged", config.Host)
	}
}

func TestConfiguredSidecarToken(t *testing.T) {
	t.Run("standalone does not require token", func(t *testing.T) {
		t.Setenv("MEDIAGO_SIDECAR_MODE", "")
		t.Setenv("MEDIAGO_SIDECAR_TOKEN", "")
		token, err := configuredSidecarToken()
		if err != nil {
			t.Fatalf("configuredSidecarToken() error = %v", err)
		}
		if token != "" {
			t.Fatalf("token = %q, want empty", token)
		}
	})

	t.Run("sidecar requires token", func(t *testing.T) {
		t.Setenv("MEDIAGO_SIDECAR_MODE", "1")
		t.Setenv("MEDIAGO_SIDECAR_TOKEN", "short")
		if _, err := configuredSidecarToken(); err == nil {
			t.Fatal("configuredSidecarToken() returned nil error")
		}
	})

	t.Run("sidecar accepts generated token", func(t *testing.T) {
		const expected = "a-generated-sidecar-token-that-is-long-enough"
		t.Setenv("MEDIAGO_SIDECAR_MODE", "1")
		t.Setenv("MEDIAGO_SIDECAR_TOKEN", expected)
		token, err := configuredSidecarToken()
		if err != nil {
			t.Fatalf("configuredSidecarToken() error = %v", err)
		}
		if token != expected {
			t.Fatalf("token = %q, want %q", token, expected)
		}
	})
}

func TestApplyPackagedToolDefaultsUsesSiblingToolsDir(t *testing.T) {
	resourcesDir := t.TempDir()
	binDir := filepath.Join(resourcesDir, "bin")
	toolsDir := filepath.Join(resourcesDir, "tools")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(bin) error = %v", err)
	}
	if err := os.MkdirAll(toolsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(tools) error = %v", err)
	}
	originalExecutablePath := executablePath
	executablePath = func() (string, error) {
		return filepath.Join(binDir, "mediago-server"), nil
	}
	t.Cleanup(func() {
		executablePath = originalExecutablePath
	})

	config := serverconfig.ServerConfig{}
	applyPackagedToolDefaults(&config)

	if config.FFmpeg.BinDir != toolsDir {
		t.Fatalf("FFmpeg.BinDir = %q, want packaged tools dir %q", config.FFmpeg.BinDir, toolsDir)
	}
	if config.Jimeng.BinDir != toolsDir {
		t.Fatalf("Jimeng.BinDir = %q, want packaged tools dir %q", config.Jimeng.BinDir, toolsDir)
	}
	if config.LibTV.BinDir != toolsDir {
		t.Fatalf("LibTV.BinDir = %q, want packaged tools dir %q", config.LibTV.BinDir, toolsDir)
	}

}

func TestApplyPackagedToolDefaultsKeepsExplicitToolDirs(t *testing.T) {
	resourcesDir := t.TempDir()
	binDir := filepath.Join(resourcesDir, "bin")
	toolsDir := filepath.Join(resourcesDir, "tools")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(bin) error = %v", err)
	}
	if err := os.MkdirAll(toolsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(tools) error = %v", err)
	}
	originalExecutablePath := executablePath
	executablePath = func() (string, error) {
		return filepath.Join(binDir, "mediago-server"), nil
	}
	t.Cleanup(func() {
		executablePath = originalExecutablePath
	})

	config := serverconfig.ServerConfig{}
	config.FFmpeg.BinDir = "/custom/ffmpeg-tools"
	config.Jimeng.BinDir = "/custom/jimeng-tools"
	config.LibTV.BinDir = "/custom/libtv-tools"
	applyPackagedToolDefaults(&config)

	if config.FFmpeg.BinDir != "/custom/ffmpeg-tools" {
		t.Fatalf("FFmpeg.BinDir = %q, want explicit value", config.FFmpeg.BinDir)
	}
	if config.Jimeng.BinDir != "/custom/jimeng-tools" {
		t.Fatalf("Jimeng.BinDir = %q, want explicit value", config.Jimeng.BinDir)
	}
	if config.LibTV.BinDir != "/custom/libtv-tools" {
		t.Fatalf("LibTV.BinDir = %q, want explicit value", config.LibTV.BinDir)
	}

}

func TestParseServerPort(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    int
		wantErr bool
	}{
		{name: "valid", value: "48273", want: 48273},
		{name: "trimmed", value: " 49152 ", want: 49152},
		{name: "automatic port", value: "0", want: 0},
		{name: "too large", value: "65536", wantErr: true},
		{name: "not numeric", value: "abc", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseServerPort(tt.value)
			if tt.wantErr {
				if err == nil {
					t.Fatal("parseServerPort returned nil error, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseServerPort returned error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("parseServerPort = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestTruthyEnvValue(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "one", value: "1", want: true},
		{name: "true", value: "true", want: true},
		{name: "trimmed yes", value: " yes ", want: true},
		{name: "on", value: "ON", want: true},
		{name: "empty", value: "", want: false},
		{name: "zero", value: "0", want: false},
		{name: "false", value: "false", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := truthyEnvValue(tt.value); got != tt.want {
				t.Fatalf("truthyEnvValue(%q) = %t, want %t", tt.value, got, tt.want)
			}
		})
	}
}
