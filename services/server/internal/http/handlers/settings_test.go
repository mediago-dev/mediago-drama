package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
	"gorm.io/gorm"
)

type fakeAPIKeyStore struct {
	values map[string]string
}

func (store *fakeAPIKeyStore) Get(keyName string) (string, string, error) {
	value := store.values[keyName]
	if value == "" {
		return "", "none", nil
	}
	return value, "settings", nil
}

func (store *fakeAPIKeyStore) Set(keyName string, value string) error {
	store.values[keyName] = strings.TrimSpace(value)
	return nil
}

func (store *fakeAPIKeyStore) Clear(keyName string) error {
	delete(store.values, keyName)
	return nil
}

type fakeAgentModelProfileStore struct {
	values map[string]domain.AgentModelProfileModel
}

func (store *fakeAgentModelProfileStore) ListAgentModelProfiles() ([]domain.AgentModelProfileModel, error) {
	result := make([]domain.AgentModelProfileModel, 0, len(store.values))
	for _, value := range store.values {
		result = append(result, value)
	}
	return result, nil
}

func (store *fakeAgentModelProfileStore) GetAgentModelProfile(id string) (domain.AgentModelProfileModel, error) {
	value, ok := store.values[strings.TrimSpace(id)]
	if !ok {
		return domain.AgentModelProfileModel{}, gorm.ErrRecordNotFound
	}
	return value, nil
}

func (store *fakeAgentModelProfileStore) UpsertAgentModelProfile(model domain.AgentModelProfileModel) error {
	store.values[model.ID] = model
	return nil
}

func (store *fakeAgentModelProfileStore) DeleteAgentModelProfile(id string) (bool, error) {
	id = strings.TrimSpace(id)
	if _, ok := store.values[id]; !ok {
		return false, nil
	}
	delete(store.values, id)
	return true, nil
}

func (store *fakeAgentModelProfileStore) ClearAgentModelProfileDefaults() error {
	for id, value := range store.values {
		value.IsDefault = false
		store.values[id] = value
	}
	return nil
}

func (store *fakeAgentModelProfileStore) SetAgentModelProfileDefault(id string) error {
	id = strings.TrimSpace(id)
	if _, ok := store.values[id]; !ok {
		return gorm.ErrRecordNotFound
	}
	for profileID, value := range store.values {
		value.IsDefault = profileID == id
		store.values[profileID] = value
	}
	return nil
}

func TestSettingsHandlerPutAndListAPIKeys(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	handler := NewSettings(service.NewSettings(&fakeAPIKeyStore{values: map[string]string{}}))
	router.GET("/settings/api-keys", handler.HandleAPIKeys)
	router.PUT("/settings/api-keys/:provider", handler.HandlePutAPIKey)

	request := httptest.NewRequest(http.MethodPut, "/settings/api-keys/openrouter", strings.NewReader(`{"apiKey":"sk-handler"}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"id":"openrouter"`) ||
		!strings.Contains(response.Body.String(), `"configured":true`) ||
		!strings.Contains(response.Body.String(), `"source":"settings"`) {
		t.Fatalf("PUT body = %s, want configured openrouter provider", response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/settings/api-keys", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"configured":true`) {
		t.Fatalf("GET body = %s, want configured provider", response.Body.String())
	}
}

func TestSettingsHandlerAgentModelProfilesLifecycle(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	handler := NewSettings(service.NewSettingsWithAgentModelProfiles(
		&fakeAPIKeyStore{values: map[string]string{}},
		&fakeAgentModelProfileStore{values: map[string]domain.AgentModelProfileModel{}},
	))
	router.GET("/settings/agent-model-profiles", handler.HandleAgentModelProfiles)
	router.POST("/settings/agent-model-profiles", handler.HandlePostAgentModelProfile)
	router.PUT("/settings/agent-model-profiles/:profileId/default", handler.HandlePutAgentModelProfileDefault)
	router.PUT("/settings/agent-model-profiles/:profileId/api-key", handler.HandlePutAgentModelProfileAPIKey)
	router.DELETE("/settings/agent-model-profiles/:profileId/api-key", handler.HandleDeleteAgentModelProfileAPIKey)

	request := httptest.NewRequest(http.MethodPost, "/settings/agent-model-profiles", strings.NewReader(`{"templateId":"minimax"}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"defaultProfileId":"minimax-cn"`) ||
		!strings.Contains(response.Body.String(), `"id":"minimax-cn"`) ||
		!strings.Contains(response.Body.String(), `"providerId":"minimax-cn"`) ||
		!strings.Contains(response.Body.String(), `"configured":false`) {
		t.Fatalf("POST body = %s, want minimax default profile without key", response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPut, "/settings/agent-model-profiles/minimax-cn/api-key", strings.NewReader(`{"apiKey":"sk-handler-secret"}`))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("PUT key status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"configured":true`) ||
		strings.Contains(response.Body.String(), "sk-handler-secret") {
		t.Fatalf("PUT key body = %s, want redacted configured key", response.Body.String())
	}

	request = httptest.NewRequest(http.MethodDelete, "/settings/agent-model-profiles/minimax-cn/api-key", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("DELETE key status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"configured":false`) {
		t.Fatalf("DELETE key body = %s, want unconfigured key", response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "/settings/agent-model-profiles", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"templates"`) || !strings.Contains(response.Body.String(), `"providerId":"minimax-cn"`) {
		t.Fatalf("GET body = %s, want templates and minimax profile", response.Body.String())
	}
}

func TestSettingsHandlerAgentModelProfileValidation(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	handler := NewSettings(service.NewSettingsWithAgentModelProfiles(
		&fakeAPIKeyStore{values: map[string]string{}},
		&fakeAgentModelProfileStore{values: map[string]domain.AgentModelProfileModel{}},
	))
	router.POST("/settings/agent-model-profiles", handler.HandlePostAgentModelProfile)
	router.PUT("/settings/agent-model-profiles/:profileId/api-key", handler.HandlePutAgentModelProfileAPIKey)
	router.PUT("/settings/agent-model-profiles/:profileId/default", handler.HandlePutAgentModelProfileDefault)

	request := httptest.NewRequest(http.MethodPost, "/settings/agent-model-profiles", strings.NewReader(`{"templateId":"minimax","extra":true}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status = %d, want 400; body = %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPut, "/settings/agent-model-profiles/missing/api-key", strings.NewReader(`{"apiKey":"sk"}`))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("missing key status = %d, want 404; body = %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPut, "/settings/agent-model-profiles/missing/default", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("missing default status = %d, want 404; body = %s", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, "/settings/agent-model-profiles", strings.NewReader(`{"templateId":"minimax"}`))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("create status = %d, body = %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodPost, "/settings/agent-model-profiles", strings.NewReader(`{"templateId":"minimax"}`))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d, want 409; body = %s", response.Code, response.Body.String())
	}
}

func TestSettingsHandlerValidation(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	handler := NewSettings(service.NewSettings(&fakeAPIKeyStore{values: map[string]string{}}))
	router.PUT("/settings/api-keys/:provider", handler.HandlePutAPIKey)

	tests := []struct {
		name   string
		path   string
		body   string
		status int
	}{
		{name: "missing provider", path: "/settings/api-keys/missing", body: `{"apiKey":"sk"}`, status: http.StatusNotFound},
		{name: "blank key", path: "/settings/api-keys/openrouter", body: `{"apiKey":" "}`, status: http.StatusBadRequest},
		{name: "unknown field", path: "/settings/api-keys/openrouter", body: `{"apiKey":"sk","extra":true}`, status: http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPut, test.path, strings.NewReader(test.body))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, test.status, response.Body.String())
			}
		})
	}
}
