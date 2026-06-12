package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFromYAML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.yaml")
	if err := os.WriteFile(path, []byte(`
host: " 0.0.0.0 "
port: 19090
log_path: " /tmp/mediago-server.log "
log_level: " debug "
workspace_dir: " /tmp/media-workspace "
acp_command: " codex-acp --model test "
ffmpeg:
  path: " /opt/ffmpeg "
  bin_dir: " /opt/vendor/ffmpeg "
billing:
  price_overlay_path: " ./pricing.json "
prompt:
  max_section_chars: 9000
internal_api:
  url: " http://internal.test "
  token: " yaml-token "
document_mcp:
  session_id: " session-yaml "
  run_id: " run-yaml "
  bridge_url: " http://bridge.test "
  bridge_token: " bridge-token "
  role_persona: " persona "
  agent_tag: " agent "
  active_document_id: " doc-1 "
  selection_text: " selected "
`), 0o600); err != nil {
		t.Fatalf("writing config: %v", err)
	}

	config, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if config.Host != "0.0.0.0" ||
		config.Port != 19090 ||
		config.LogPath != "/tmp/mediago-server.log" ||
		config.LogLevel != "debug" ||
		config.WorkspaceDir != "/tmp/media-workspace" ||
		config.ACPCommand != "codex-acp --model test" ||
		config.FFmpeg.Path != "/opt/ffmpeg" ||
		config.FFmpeg.BinDir != "/opt/vendor/ffmpeg" ||
		config.Billing.PriceOverlayPath != "./pricing.json" ||
		config.Prompt.MaxSectionChars != 9000 ||
		config.InternalAPI.URL != "http://internal.test" ||
		config.InternalAPI.Token != "yaml-token" ||
		config.DocumentMCP.SessionID != "session-yaml" ||
		config.DocumentMCP.RunID != "run-yaml" ||
		config.DocumentMCP.BridgeURL != "http://bridge.test" ||
		config.DocumentMCP.BridgeToken != "bridge-token" ||
		config.DocumentMCP.RolePersona != "persona" ||
		config.DocumentMCP.AgentTag != "agent" ||
		config.DocumentMCP.ActiveDocumentID != "doc-1" ||
		config.DocumentMCP.SelectionText != "selected" {
		t.Fatalf("config = %#v, want YAML-backed server config", config)
	}
}

func TestLoadDefaults(t *testing.T) {
	config, err := Load("")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if config.Host != "127.0.0.1" || config.Port != 8080 || config.Prompt.MaxSectionChars != 12000 {
		t.Fatalf("config = %#v, want default host and port", config)
	}
}

func TestInternalAPIFromLookupTrimsValues(t *testing.T) {
	config := InternalAPIFromLookup(func(name string) string {
		switch name {
		case oneInternalAPIURLEnv:
			return " http://127.0.0.1:8080 "
		case oneInternalAPITokenEnv:
			return " token "
		default:
			return ""
		}
	})

	if config.URL != "http://127.0.0.1:8080" || config.Token != "token" {
		t.Fatalf("config = %#v, want trimmed internal API config", config)
	}
}

func TestInternalAPIFromConfigLookupAppliesEnvOverride(t *testing.T) {
	config := InternalAPIFromConfigLookup(
		InternalAPIConfig{URL: "http://yaml.test", Token: "yaml-token"},
		func(name string) string {
			switch name {
			case oneInternalAPIURLEnv:
				return " http://env.test "
			default:
				return ""
			}
		},
	)

	if config.URL != "http://env.test" || config.Token != "yaml-token" {
		t.Fatalf("config = %#v, want env URL override and YAML token fallback", config)
	}
}

func TestDocumentMCPFromLookupUsesProtocolConfig(t *testing.T) {
	config := DocumentMCPFromLookup(func(name string) string {
		if name == "MEDIAGO_DRAMA_AGENT_SESSION_ID" {
			return " session "
		}
		return ""
	})

	if config.SessionID != "session" {
		t.Fatalf("session = %q, want trimmed protocol environment value", config.SessionID)
	}
}

func TestDocumentMCPFromConfigLookupAppliesEnvOverride(t *testing.T) {
	config := DocumentMCPFromConfigLookup(
		DocumentMCPConfig{
			SessionID:        "yaml-session",
			RunID:            "yaml-run",
			BridgeURL:        "http://yaml-bridge.test",
			BridgeToken:      "yaml-token",
			RolePersona:      "yaml-persona",
			AgentTag:         "yaml-agent",
			ActiveDocumentID: "yaml-doc",
			SelectionText:    "yaml-selection",
		},
		func(name string) string {
			switch name {
			case "MEDIAGO_DRAMA_AGENT_SESSION_ID":
				return " env-session "
			case "MEDIAGO_DRAMA_AGENT_BRIDGE_TOKEN":
				return " env-token "
			default:
				return ""
			}
		},
	)

	if config.SessionID != "env-session" ||
		config.RunID != "yaml-run" ||
		config.BridgeURL != "http://yaml-bridge.test" ||
		config.BridgeToken != "env-token" ||
		config.RolePersona != "yaml-persona" ||
		config.AgentTag != "yaml-agent" ||
		config.ActiveDocumentID != "yaml-doc" ||
		config.SelectionText != "yaml-selection" {
		t.Fatalf("config = %#v, want env overrides over YAML document MCP config", config)
	}
}
