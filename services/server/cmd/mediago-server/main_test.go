package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	serverconfig "github.com/mediago-dev/mediago-drama/services/server/internal/config"
)

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
	t.Setenv("MEDIAGO_PIPPIT_PATH", "/tmp/pippit-tool-cli")
	t.Setenv("MEDIAGO_PIPPIT_BIN_DIR", "/tmp/tools/pippit")
	t.Setenv("MEDIAGO_SERVER_PORT", "48273")
	t.Setenv("MEDIAGO_LOG_LEVEL", "debug")
	t.Setenv("MEDIAGO_MODEL_PLATFORM", "mediago,openrouter")
	t.Setenv("MEDIAGO_GENERATION_CLIS", "xiaoyunque,libtv")
	t.Setenv("MEDIAGO_MODEL_PLATFORM_MEDIAGO_BASE_URL", "https://models.example.test/v1/")

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
	if config.Pippit.Path != "/tmp/pippit-tool-cli" {
		t.Fatalf("Pippit.Path = %q, want %q", config.Pippit.Path, "/tmp/pippit-tool-cli")
	}
	if config.Pippit.BinDir != "/tmp/tools/pippit" {
		t.Fatalf("Pippit.BinDir = %q, want %q", config.Pippit.BinDir, "/tmp/tools/pippit")
	}
	if config.Port != 48273 {
		t.Fatalf("Port = %d, want %d", config.Port, 48273)
	}
	if config.LogLevel != "debug" {
		t.Fatalf("LogLevel = %q, want debug", config.LogLevel)
	}
	if got := strings.Join(config.ModelPlatforms, ","); got != "mediago,openrouter" {
		t.Fatalf("ModelPlatforms = %q, want mediago,openrouter", got)
	}
	if got := strings.Join(config.GenerationCLIs, ","); got != "xiaoyunque,libtv" {
		t.Fatalf("GenerationCLIs = %q, want xiaoyunque,libtv", got)
	}
	if config.MediagoBaseURL != "https://models.example.test/v1" {
		t.Fatalf("MediagoBaseURL = %q, want trimmed base URL", config.MediagoBaseURL)
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
	if config.Pippit.BinDir != toolsDir {
		t.Fatalf("Pippit.BinDir = %q, want packaged tools dir %q", config.Pippit.BinDir, toolsDir)
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
	config.Pippit.BinDir = "/custom/pippit-tools"
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
	if config.Pippit.BinDir != "/custom/pippit-tools" {
		t.Fatalf("Pippit.BinDir = %q, want explicit value", config.Pippit.BinDir)
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
		{name: "zero", value: "0", wantErr: true},
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

func TestLoadBillingPricesFromConfigRelativeOverlay(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "server.yaml")
	overlayPath := filepath.Join(dir, "pricing.json")
	if err := os.WriteFile(overlayPath, []byte(`{
		"prices": [
			{"routeId":"dmx.gpt-4.1-mini-text","currency":"CNY","unit":"per_call","perCallPrice":2.5}
		]
	}`), 0o600); err != nil {
		t.Fatalf("writing overlay: %v", err)
	}

	table, err := loadBillingPrices(" pricing.json ", configPath)
	if err != nil {
		t.Fatalf("loadBillingPrices() error = %v", err)
	}
	price, ok := table.Find(coregeneration.RouteDMXGPT41MiniText)
	if !ok {
		t.Fatal("overlay route missing")
	}
	if price.Currency != "CNY" || price.Unit != corepricing.UnitPerCall || price.PerCallPrice != 2.5 {
		t.Fatalf("price = %#v", price)
	}
}

func TestLoadBillingPricesUsesDefaultWithoutOverlay(t *testing.T) {
	table, err := loadBillingPrices("", "")
	if err != nil {
		t.Fatalf("loadBillingPrices() error = %v", err)
	}
	if _, ok := table.Find(coregeneration.RouteDMXGPT41MiniText); !ok {
		t.Fatal("default price table missing text route")
	}
}

func TestBillingPriceOverlayCoversAvailableRoutes(t *testing.T) {
	overlayPath := filepath.Join("..", "..", "configs", "pricing.overlay.json")
	raw, err := os.ReadFile(overlayPath)
	if err != nil {
		t.Fatalf("reading overlay: %v", err)
	}
	var overlay struct {
		Prices []corepricing.RoutePrice `json:"prices"`
	}
	if err := json.Unmarshal(raw, &overlay); err != nil {
		t.Fatalf("parsing overlay: %v", err)
	}
	overlayRoutes := map[string]bool{}
	for _, price := range overlay.Prices {
		overlayRoutes[price.RouteID] = true
	}

	missing := []string{}
	for _, route := range coregeneration.Routes() {
		if route.Status != coregeneration.RouteStatusAvailable {
			continue
		}
		if !overlayRoutes[route.ID] {
			missing = append(missing, route.ID)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("available routes missing overlay prices: %s", strings.Join(missing, ", "))
	}

	table, err := loadBillingPrices(
		"pricing.overlay.json",
		filepath.Join("..", "..", "configs", "server.yaml"),
	)
	if err != nil {
		t.Fatalf("loadBillingPrices() error = %v", err)
	}

	cost, ok := corepricing.EstimateCost(table, coregeneration.RouteOfficialGPT41MiniText, corepricing.Usage{
		InputTokens:  1_000_000,
		OutputTokens: 500_000,
		CachedTokens: 100_000,
	})
	if !ok {
		t.Fatal("sample route price missing")
	}
	if cost.Currency != "USD" || cost.Amount <= 0 {
		t.Fatalf("sample cost = %#v, want positive USD cost", cost)
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
