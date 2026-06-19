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
	t.Setenv("MEDIAGO_SERVER_PORT", "48273")
	t.Setenv("MEDIAGO_LOG_LEVEL", "debug")

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
	if config.Port != 48273 {
		t.Fatalf("Port = %d, want %d", config.Port, 48273)
	}
	if config.LogLevel != "debug" {
		t.Fatalf("LogLevel = %q, want debug", config.LogLevel)
	}
}

func TestApplyEnvOverridesRejectsInvalidServerPort(t *testing.T) {
	t.Setenv("MEDIAGO_SERVER_PORT", "70000")

	config := serverconfig.ServerConfig{Port: 8080}
	if err := applyEnvOverrides(&config); err == nil {
		t.Fatal("applyEnvOverrides returned nil error, want invalid port error")
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
