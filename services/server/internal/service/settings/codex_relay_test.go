package settings

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
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
			Model:    "gpt-5.6-sol",
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
		`model = "gpt-5.6-sol"`,
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

func TestDescribeCodexRuntimeHomeIsPureAndUsesActiveRelayPredicate(t *testing.T) {
	tests := []struct {
		name       string
		configure  func(*testing.T, *Settings, context.Context)
		wantActive bool
	}{
		{name: "relay absent"},
		{
			name: "relay disabled",
			configure: func(t *testing.T, service *Settings, ctx context.Context) {
				saveCodexRelayRuntimeHomeFixture(t, service, false, true)
			},
		},
		{
			name: "credentials missing",
			configure: func(t *testing.T, service *Settings, ctx context.Context) {
				saveCodexRelayRuntimeHomeFixture(t, service, true, false)
			},
		},
		{
			name: "relay active",
			configure: func(t *testing.T, service *Settings, ctx context.Context) {
				saveCodexRelayRuntimeHomeFixture(t, service, true, true)
			},
			wantActive: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := NewSettingsWithStores(
				&memoryAPIKeyStore{values: map[string]string{}},
				nil,
				&memoryAppSettingStore{values: map[string]string{}},
			)
			ctx := context.Background()
			if tt.configure != nil {
				tt.configure(t, service, ctx)
			}
			workspaceDir := t.TempDir()
			descriptor, err := service.DescribeCodexRuntimeHome(ctx, workspaceDir)
			if err != nil {
				t.Fatalf("DescribeCodexRuntimeHome returned error: %v", err)
			}
			wantHome := filepath.Join(workspaceDir, ".mediago-drama", "runtime", "agents", "codex", "home")
			if tt.wantActive {
				if !descriptor.Isolated || descriptor.CodexHome != wantHome {
					t.Fatalf("descriptor = %#v, want isolated %q", descriptor, wantHome)
				}
			} else if descriptor.Isolated || descriptor.CodexHome != "" {
				t.Fatalf("descriptor = %#v, want no override", descriptor)
			}
			for _, path := range []string{wantHome, filepath.Join(wantHome, "config.toml"), filepath.Join(wantHome, "auth.json")} {
				if _, statErr := os.Stat(path); !errors.Is(statErr, os.ErrNotExist) {
					t.Fatalf("pure descriptor created %s: %v", path, statErr)
				}
			}
		})
	}
}

func saveCodexRelayRuntimeHomeFixture(t *testing.T, service *Settings, enabled bool, withKey bool) {
	t.Helper()
	ctx := context.Background()
	if _, err := service.SaveCodexRelaySettings(ctx, CodexRelaySettingsMutation{
		Enabled:         enabled,
		ActiveProfileID: "relay",
		Profiles: []CodexRelayProfileMutation{{
			ID:       "relay",
			Name:     "Relay",
			BaseURL:  "https://relay.example.com/v1",
			Model:    "gpt-5.6",
			Protocol: CodexRelayProtocolResponses,
			Enabled:  true,
		}},
	}); err != nil {
		t.Fatalf("SaveCodexRelaySettings returned error: %v", err)
	}
	if withKey {
		if _, err := service.SetCodexRelayProfileAPIKey(ctx, "relay", "sk-runtime-home"); err != nil {
			t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
		}
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

func TestCheckCodexRelayAuthenticatesUpstream(t *testing.T) {
	var gotAuth string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotAuth = request.Header.Get("Authorization")
		gotPath = request.URL.Path
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"data":[{"id":"GPT-5.5"},{"id":"gpt-5.4"},{"id":"GPT-5.4-Mini"},{"id":"gpt-5.6-terra"},{"id":"codex-auto-review"},{"id":"gpt-5.6-luna"},{"id":"gpt-5.6-sol"},{"id":"gpt-5.6-sol"},{"id":"  "},{"object":"model"}]}`)
	}))
	defer server.Close()

	service := NewSettingsWithStores(
		&memoryAPIKeyStore{values: map[string]string{}},
		nil,
		&memoryAppSettingStore{values: map[string]string{}},
	)
	ctx := context.Background()
	if _, err := service.SaveCodexRelaySettings(ctx, CodexRelaySettingsMutation{
		Enabled:         false,
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
	if _, err := service.SetCodexRelayProfileAPIKey(ctx, "relay", "sk-upstream-check"); err != nil {
		t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
	}

	result, err := service.CheckCodexRelay(ctx, CodexRelayCheckRequest{})
	if err != nil {
		t.Fatalf("CheckCodexRelay returned error: %v", err)
	}
	if !result.OK || result.StatusCode != http.StatusOK || result.ProfileID != "relay" {
		t.Fatalf("result = %#v, want successful relay check", result)
	}
	if gotAuth != "Bearer sk-upstream-check" {
		t.Fatalf("authorization = %q, want stored upstream key", gotAuth)
	}
	if gotPath != "/v1/models" {
		t.Fatalf("path = %q, want models check path", gotPath)
	}
	wantModels := []string{
		"gpt-5.6-sol",
		"gpt-5.6-terra",
		"gpt-5.6-luna",
		"GPT-5.5",
		"gpt-5.4",
		"GPT-5.4-Mini",
		"codex-auto-review",
	}
	if !reflect.DeepEqual(result.Models, wantModels) {
		t.Fatalf("models = %#v, want sorted unique model ids %#v", result.Models, wantModels)
	}
}

func TestCheckCodexRelayKeepsConnectivitySuccessWhenModelCatalogIsMalformed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"data":`)
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
			Model:    "gpt-5.6-sol",
			Protocol: CodexRelayProtocolResponses,
			Enabled:  true,
		}},
	}); err != nil {
		t.Fatalf("SaveCodexRelaySettings returned error: %v", err)
	}
	if _, err := service.SetCodexRelayProfileAPIKey(ctx, "relay", "sk-upstream-check"); err != nil {
		t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
	}

	result, err := service.CheckCodexRelay(ctx, CodexRelayCheckRequest{})
	if err != nil {
		t.Fatalf("CheckCodexRelay returned error: %v", err)
	}
	if !result.OK || result.StatusCode != http.StatusOK || len(result.Models) != 0 {
		t.Fatalf("result = %#v, want successful check with no parsed models", result)
	}
}

func TestCheckCodexRelayCanProbeSelectedProfile(t *testing.T) {
	var gotAuth string
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotAuth = request.Header.Get("Authorization")
		gotPath = request.URL.Path
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"data":[]}`)
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
		Profiles: []CodexRelayProfileMutation{
			{
				ID:       "relay",
				Name:     "Relay",
				BaseURL:  "https://active.example.com/v1",
				Model:    "gpt-5.5",
				Protocol: CodexRelayProtocolResponses,
				Enabled:  true,
			},
			{
				ID:       "relay-2",
				Name:     "Relay 2",
				BaseURL:  server.URL + "/v1",
				Model:    "gpt-5.5",
				Protocol: CodexRelayProtocolResponses,
				Enabled:  false,
			},
		},
	}); err != nil {
		t.Fatalf("SaveCodexRelaySettings returned error: %v", err)
	}
	if _, err := service.SetCodexRelayProfileAPIKey(ctx, "relay-2", "sk-selected-check"); err != nil {
		t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
	}

	result, err := service.CheckCodexRelay(ctx, CodexRelayCheckRequest{ProfileID: "relay-2"})
	if err != nil {
		t.Fatalf("CheckCodexRelay returned error: %v", err)
	}
	if !result.OK || result.StatusCode != http.StatusOK || result.ProfileID != "relay-2" {
		t.Fatalf("result = %#v, want successful selected relay check", result)
	}
	if gotAuth != "Bearer sk-selected-check" {
		t.Fatalf("authorization = %q, want selected profile key", gotAuth)
	}
	if gotPath != "/v1/models" {
		t.Fatalf("path = %q, want models check path", gotPath)
	}
}

func TestCheckCodexRelayReportsInvalidAPIKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(writer, `{"code":"INVALID_API_KEY","message":"Invalid API key"}`)
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
	if _, err := service.SetCodexRelayProfileAPIKey(ctx, "relay", "sk-secret-that-must-not-leak"); err != nil {
		t.Fatalf("SetCodexRelayProfileAPIKey returned error: %v", err)
	}

	result, err := service.CheckCodexRelay(ctx, CodexRelayCheckRequest{})
	if !errors.Is(err, ErrCodexRelayCheckFailed) {
		t.Fatalf("err = %v, want ErrCodexRelayCheckFailed", err)
	}
	if result.OK || result.StatusCode != http.StatusUnauthorized {
		t.Fatalf("result = %#v, want failed unauthorized check", result)
	}
	if strings.Contains(err.Error(), "sk-secret-that-must-not-leak") {
		t.Fatalf("check error leaked api key: %v", err)
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
