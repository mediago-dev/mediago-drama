package settings

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type memoryAppSettingStore struct {
	mu     sync.RWMutex
	values map[string]string
}

func (store *memoryAppSettingStore) GetAppSetting(key string) (string, bool, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	value, ok := store.values[key]
	return value, ok, nil
}

func (store *memoryAppSettingStore) SetAppSetting(key string, value string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.values[key] = value
	return nil
}

func (store *memoryAppSettingStore) ClearAppSetting(key string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.values, key)
	return nil
}

func TestCodexRelaySettingsStoresProfileAndRedactsAPIKey(t *testing.T) {
	keyStore := &memoryAPIKeyStore{values: map[string]string{}}
	service := NewSettingsWithStores(
		keyStore,
		nil,
		&memoryAppSettingStore{values: map[string]string{}},
	)
	ctx := context.Background()

	settings, err := service.SaveCodexRelaySettings(ctx, CodexRelaySettingsMutation{
		Enabled:         true,
		ActiveProfileID: "APIKEY.FUN",
		Profiles: []CodexRelayProfileMutation{{
			ID:       "APIKEY.FUN",
			Name:     "APIKEY.FUN",
			BaseURL:  " https://relay.example.com/v1/ ",
			Model:    "gpt-5.5",
			Protocol: CodexRelayProtocolResponses,
			Enabled:  true,
		}},
	})
	if err != nil {
		t.Fatalf("SaveCodexRelaySettings returned error: %v", err)
	}
	if settings.ActiveProfileID != "apikey-fun" || settings.Profiles[0].ID != "apikey-fun" {
		t.Fatalf("settings = %#v, want normalized profile id", settings)
	}
	if settings.Profiles[0].BaseURL != "https://relay.example.com/v1" {
		t.Fatalf("baseURL = %q, want trimmed url", settings.Profiles[0].BaseURL)
	}

	settings, err = service.SetCodexRelayProfileAPIKey(ctx, "apikey-fun", "sk-codex-relay-secret")
	if err != nil {
		t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
	}
	profile := settings.Profiles[0]
	if !profile.APIKey.Configured || profile.APIKey.Source != "settings" {
		t.Fatalf("api key status = %#v, want configured settings key", profile.APIKey)
	}
	if strings.Contains(profile.APIKey.Masked, "codex-relay-secret") {
		t.Fatalf("masked key leaks secret: %q", profile.APIKey.Masked)
	}

	if _, err := service.SaveCodexRelaySettings(ctx, CodexRelaySettingsMutation{}); err != nil {
		t.Fatalf("SaveCodexRelaySettings clearing profiles returned error: %v", err)
	}
	value, source, err := keyStore.Get(CodexRelayAPIKeyName("apikey-fun"))
	if err != nil {
		t.Fatalf("Get cleared key returned error: %v", err)
	}
	if value != "" || source != "none" {
		t.Fatalf("cleared key = %q source=%q, want removed", value, source)
	}
}

func TestPrepareCodexRelayRuntimeConfigWritesLocalCodexHomeWithoutSecret(t *testing.T) {
	service := NewSettingsWithStores(
		&memoryAPIKeyStore{values: map[string]string{}},
		nil,
		&memoryAppSettingStore{values: map[string]string{}},
	)
	ctx := context.Background()
	if _, err := service.SaveCodexRelaySettings(ctx, CodexRelaySettingsMutation{
		Enabled:         true,
		ActiveProfileID: "relay",
		Profiles: []CodexRelayProfileMutation{{
			ID:       "relay",
			Name:     "Relay",
			BaseURL:  "https://relay.example.com/v1",
			Model:    "deepseek-v4-pro",
			Protocol: CodexRelayProtocolResponses,
			Enabled:  true,
		}},
	}); err != nil {
		t.Fatalf("SaveCodexRelaySettings returned error: %v", err)
	}
	if _, err := service.SetCodexRelayProfileAPIKey(ctx, "relay", "sk-real-secret"); err != nil {
		t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
	}

	workspaceDir := t.TempDir()
	config, err := service.PrepareCodexRelayRuntimeConfig(ctx, workspaceDir, "http://127.0.0.1:8080/api/v1/codex-relay")
	if err != nil {
		t.Fatalf("PrepareCodexRelayRuntimeConfig returned error: %v", err)
	}
	wantHome := filepath.Join(workspaceDir, ".mediago-drama", "runtime", "agents", "codex", "home")
	if config.CodexHome != wantHome || config.Env["CODEX_HOME"] != wantHome {
		t.Fatalf("config = %#v, want CODEX_HOME under workspace metadata", config)
	}
	if config.Env["OPENAI_API_KEY"] == "sk-real-secret" {
		t.Fatalf("OPENAI_API_KEY should not contain upstream secret")
	}
	configText := readTextFile(t, filepath.Join(wantHome, "config.toml"))
	if strings.Contains(configText, "sk-real-secret") {
		t.Fatalf("config.toml leaks secret:\n%s", configText)
	}
	for _, want := range []string{
		`model = "deepseek-v4-pro"`,
		`model_provider = "mediago-codex-relay"`,
		`base_url = "http://127.0.0.1:8080/api/v1/codex-relay/v1"`,
	} {
		if !strings.Contains(configText, want) {
			t.Fatalf("config.toml missing %q:\n%s", want, configText)
		}
	}
	authText := readTextFile(t, filepath.Join(wantHome, "auth.json"))
	if strings.Contains(authText, "sk-real-secret") {
		t.Fatalf("auth.json leaks secret: %s", authText)
	}
}

func TestOpenCodexRelayRequestForwardsResponsesRequestWithStoredKey(t *testing.T) {
	var gotAuth string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotAuth = request.Header.Get("Authorization")
		gotPath = request.URL.Path
		body, _ := io.ReadAll(request.Body)
		if !strings.Contains(string(body), `"model":"gpt-5.5"`) {
			t.Fatalf("body = %s, want model payload", string(body))
		}
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"id":"resp_1","output":[]}`)
	}))
	defer server.Close()

	service := NewSettingsWithStores(
		&memoryAPIKeyStore{values: map[string]string{}},
		nil,
		&memoryAppSettingStore{values: map[string]string{}},
	)
	ctx := context.Background()
	if _, err := service.SaveCodexRelaySettings(ctx, CodexRelaySettingsMutation{
		Enabled:         true,
		ActiveProfileID: "relay",
		Profiles: []CodexRelayProfileMutation{{
			ID:       "relay",
			Name:     "Relay",
			BaseURL:  server.URL + "/v1",
			Model:    "gpt-5.5",
			Protocol: CodexRelayProtocolResponses,
			Enabled:  true,
		}},
	}); err != nil {
		t.Fatalf("SaveCodexRelaySettings returned error: %v", err)
	}
	if _, err := service.SetCodexRelayProfileAPIKey(ctx, "relay", "sk-upstream"); err != nil {
		t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
	}

	response, err := service.OpenCodexRelayRequest(
		ctx,
		http.MethodPost,
		"/v1/responses",
		[]byte(`{"model":"gpt-5.5","input":"hi"}`),
		http.Header{"Authorization": []string{"Bearer " + codexRelayLocalBearerToken}},
	)
	if err != nil {
		t.Fatalf("OpenCodexRelayRequest returned error: %v", err)
	}
	defer response.Body.Close()
	if gotAuth != "Bearer sk-upstream" {
		t.Fatalf("authorization = %q, want stored upstream key", gotAuth)
	}
	if gotPath != "/v1/responses" {
		t.Fatalf("path = %q, want deduplicated /v1/responses", gotPath)
	}
}

func TestOpenCodexRelayRequestRejectsMissingLocalBearer(t *testing.T) {
	service := NewSettingsWithStores(
		&memoryAPIKeyStore{values: map[string]string{}},
		nil,
		&memoryAppSettingStore{values: map[string]string{}},
	)

	_, err := service.OpenCodexRelayRequest(
		context.Background(),
		http.MethodPost,
		"/v1/responses",
		[]byte(`{}`),
		http.Header{},
	)
	if err != ErrCodexRelayUnauthorized {
		t.Fatalf("err = %v, want ErrCodexRelayUnauthorized", err)
	}
}

func TestCodexRelayUpstreamURLNormalizesVersionPrefix(t *testing.T) {
	got, err := codexRelayUpstreamURL("https://relay.example.com/v1", "/v1/responses")
	if err != nil {
		t.Fatalf("codexRelayUpstreamURL returned error: %v", err)
	}
	if got != "https://relay.example.com/v1/responses" {
		t.Fatalf("url = %q, want deduplicated /v1", got)
	}

	got, err = codexRelayUpstreamURL(
		"https://relay.example.com/v1",
		"/v1/responses/resp_1/input_items?after=item_1",
	)
	if err != nil {
		t.Fatalf("codexRelayUpstreamURL child path returned error: %v", err)
	}
	if got != "https://relay.example.com/v1/responses/resp_1/input_items?after=item_1" {
		t.Fatalf("url = %q, want child path with query", got)
	}
}

func readTextFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return string(raw)
}
