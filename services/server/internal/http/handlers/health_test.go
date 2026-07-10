package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHealthReportsReadyProcessIdentity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	handler := NewHealth(HealthIdentity{
		BundleRev:     42,
		SchemaVersion: 7,
		InstanceToken: "instance-42",
	}, func() error { return nil })
	router.GET("/health", handler.HandleHealth)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	response := decodeHealthEnvelope(t, recorder)
	if !response.Ready || response.Status != "ok" || response.BundleRev != 42 ||
		response.SchemaVersion != 7 || response.InstanceToken != "instance-42" {
		t.Fatalf("response = %+v", response)
	}
}

func TestHealthFailsClosedWhenStartupDependenciesFailed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	handler := NewHealth(HealthIdentity{
		BundleRev:     43,
		SchemaVersion: 8,
		InstanceToken: "instance-43",
	}, func() error { return errors.New("opening workspace database") })
	router.GET("/health", handler.HandleHealth)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	response := decodeHealthEnvelope(t, recorder)
	if response.Ready || response.Status != "not_ready" || response.BundleRev != 43 ||
		response.SchemaVersion != 8 || response.InstanceToken != "instance-43" {
		t.Fatalf("response = %+v", response)
	}
}

func decodeHealthEnvelope(t *testing.T, recorder *httptest.ResponseRecorder) healthResponse {
	t.Helper()
	var envelope struct {
		Data healthResponse `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decoding health response: %v", err)
	}
	return envelope.Data
}
