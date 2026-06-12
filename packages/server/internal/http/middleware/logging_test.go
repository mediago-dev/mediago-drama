package middleware

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	mediamcp "github.com/torchstellar-team/mediago-drama/packages/mcp/pkg/mcp"
)

func TestRequestLoggerDemotesExpectedDocumentMCPHangingGET(t *testing.T) {
	var logs bytes.Buffer
	restoreDefaultLogger(t, &logs)

	router := gin.New()
	router.Use(RequestLogger())
	router.GET(mediamcp.DocumentHTTPPath, func(context *gin.Context) {
		context.Status(http.StatusMethodNotAllowed)
	})

	request := httptest.NewRequest(http.MethodGet, mediamcp.DocumentHTTPPath, nil)
	router.ServeHTTP(httptest.NewRecorder(), request)

	output := logs.String()
	if !strings.Contains(output, "level=DEBUG") {
		t.Fatalf("log output = %q, want DEBUG", output)
	}
	if strings.Contains(output, "level=WARN") {
		t.Fatalf("log output = %q, should not warn for expected document MCP hanging GET", output)
	}
}

func TestRequestLoggerKeepsOtherAPI405AsWarn(t *testing.T) {
	var logs bytes.Buffer
	restoreDefaultLogger(t, &logs)

	router := gin.New()
	router.Use(RequestLogger())
	router.GET("/api/v1/other", func(context *gin.Context) {
		context.Status(http.StatusMethodNotAllowed)
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/other", nil)
	router.ServeHTTP(httptest.NewRecorder(), request)

	output := logs.String()
	if !strings.Contains(output, "level=WARN") {
		t.Fatalf("log output = %q, want WARN for other API 405", output)
	}
}

func TestRequestIDMiddlewareAddsResponseHeaderAndLogAttr(t *testing.T) {
	var logs bytes.Buffer
	restoreDefaultLogger(t, &logs)

	router := gin.New()
	router.Use(RequestID(), RequestLogger())
	router.GET("/api/v1/other", func(context *gin.Context) {
		context.Status(http.StatusMethodNotAllowed)
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/other", nil)
	request.Header.Set(requestIDHeader, "req-client")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get(requestIDHeader); got != "req-client" {
		t.Fatalf("response request id = %q, want req-client", got)
	}
	if output := logs.String(); !strings.Contains(output, "request_id=req-client") {
		t.Fatalf("log output = %q, want request id", output)
	}
}

func restoreDefaultLogger(t *testing.T, logs *bytes.Buffer) {
	t.Helper()

	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})
}
