package server

import (
	"net/http/httptest"
	"testing"
)

func TestDocumentConfigFromHTTPRequest(t *testing.T) {
	req := httptest.NewRequest("POST", "/mcp?sessionId=s1&runId=r1&agentTag=lead&activeDocumentId=doc-1&selectionText=hello", nil)
	req.Header.Set(BridgeURLHeader, " http://bridge.test ")
	req.Header.Set(BridgeTokenHeader, " token ")

	config := DocumentConfigFromHTTPRequest(req, DocumentHTTPConfigOptions{
		DefaultBridgeURL:   "http://default.test",
		DefaultBridgeToken: "default-token",
	})

	if config.SessionID != "s1" || config.RunID != "r1" {
		t.Fatalf("run config = %#v", config)
	}
	if config.BridgeURL != "http://bridge.test" || config.BridgeToken != "token" {
		t.Fatalf("bridge config = %#v", config)
	}
	if config.AgentTag != "lead" {
		t.Fatalf("agent config = %#v", config)
	}
	if config.ActiveDocumentID != "doc-1" || config.SelectionText != "hello" {
		t.Fatalf("document context = %#v", config)
	}
}

func TestDocumentConfigFromHTTPRequestUsesDefaults(t *testing.T) {
	req := httptest.NewRequest("POST", "/mcp", nil)
	config := DocumentConfigFromHTTPRequest(req, DocumentHTTPConfigOptions{
		DefaultBridgeURL:   "http://default.test",
		DefaultBridgeToken: "default-token",
	})
	if config.BridgeURL != "http://default.test" || config.BridgeToken != "default-token" {
		t.Fatalf("bridge defaults = %#v", config)
	}
}
