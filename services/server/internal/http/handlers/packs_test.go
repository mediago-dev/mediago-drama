package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

func TestPromptPacksHandlerCopiesEntriesAndReturnsPackContents(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	store := newPromptPackHandlerTestStore(t)
	if _, err := store.CreatePack(t.Context(), promptpack.Pack{
		ID:      "company.handler-pack",
		Name:    "Handler Pack",
		Version: "1.0.0",
	}); err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}
	builtin, err := store.GetPackContents(t.Context(), promptpack.DefaultPackID)
	if err != nil {
		t.Fatalf("GetPackContents(builtin) error = %v", err)
	}
	var source promptpack.Entry
	for _, entry := range builtin.Entries {
		if entry.Kind == instructionpack.KindSkill {
			source = entry
			break
		}
	}
	if source.Slug == "" {
		t.Fatal("builtin pack has no Skill entry")
	}

	handler := NewPromptPacks(store)
	router := gin.New()
	router.GET("/packs/:id/contents", handler.HandleGetPackContents)
	router.POST("/packs/:id/entries/copy", handler.HandleCopyPackEntries)
	router.PUT("/packs/:id/entries", handler.HandlePutPackEntry)
	router.POST("/packs/:id/entries/reset", handler.HandleResetPackEntry)
	router.POST("/packs/:id/entries/detach", handler.HandleDetachPackEntry)
	router.POST("/packs/:id/entries/remove", handler.HandleRemovePackEntry)

	requestBody, err := json.Marshal(copyPromptPackEntriesRequest{Entries: []promptpack.EntryReference{{
		PackID: promptpack.DefaultPackID,
		Kind:   source.Kind,
		Slug:   source.Slug,
	}}})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	request := httptest.NewRequest(
		http.MethodPost,
		"/packs/company.handler-pack/entries/copy",
		bytes.NewReader(requestBody),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body = %s", response.Code, response.Body.String())
	}
	var copiedEnvelope struct {
		Success bool                          `json:"success"`
		Data    copyPromptPackEntriesResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &copiedEnvelope); err != nil {
		t.Fatalf("Unmarshal(POST) error = %v", err)
	}
	if !copiedEnvelope.Success || len(copiedEnvelope.Data.Entries) != 1 {
		t.Fatalf("POST body = %s, want one copied entry", response.Body.String())
	}
	copied := copiedEnvelope.Data.Entries[0]
	if copied.PackID != "company.handler-pack" || !copied.Linked || copied.ReferenceSlug != source.Slug {
		t.Fatalf("copied entry = %#v, want target-owned source link", copied)
	}

	request = httptest.NewRequest(http.MethodGet, "/packs/company.handler-pack/contents", nil)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body = %s", response.Code, response.Body.String())
	}
	var contentsEnvelope struct {
		Success bool                    `json:"success"`
		Data    promptpack.PackContents `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &contentsEnvelope); err != nil {
		t.Fatalf("Unmarshal(GET) error = %v", err)
	}
	if !contentsEnvelope.Success || len(contentsEnvelope.Data.Entries) != 1 {
		t.Fatalf("GET body = %s, want copied pack contents", response.Body.String())
	}
	if contentsEnvelope.Data.Entries[0].ID != copied.ID {
		t.Fatalf("GET entry = %#v, want copied entry %q", contentsEnvelope.Data.Entries[0], copied.ID)
	}

	requestBody, err = json.Marshal(promptPackEntryRequest{EntryID: copied.ID})
	if err != nil {
		t.Fatalf("Marshal(detach) error = %v", err)
	}
	request = httptest.NewRequest(
		http.MethodPost,
		"/packs/company.handler-pack/entries/detach",
		bytes.NewReader(requestBody),
	)
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("detach status = %d, body = %s", response.Code, response.Body.String())
	}

	requestBody, err = json.Marshal(updatePromptPackEntryRequest{
		EntryID:     copied.ID,
		Description: "Handler update",
		Body:        "Updated through exact pack entry route",
	})
	if err != nil {
		t.Fatalf("Marshal(update) error = %v", err)
	}
	request = httptest.NewRequest(
		http.MethodPut,
		"/packs/company.handler-pack/entries",
		bytes.NewReader(requestBody),
	)
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", response.Code, response.Body.String())
	}
	var updatedEnvelope struct {
		Success bool             `json:"success"`
		Data    promptpack.Entry `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &updatedEnvelope); err != nil {
		t.Fatalf("Unmarshal(update) error = %v", err)
	}
	if !updatedEnvelope.Success || updatedEnvelope.Data.ID != copied.ID ||
		updatedEnvelope.Data.Description != "Handler update" ||
		updatedEnvelope.Data.Body != "Updated through exact pack entry route\n" {
		t.Fatalf("update body = %s, want exact copied entry update", response.Body.String())
	}

	requestBody, err = json.Marshal(promptPackEntryRequest{EntryID: copied.ID})
	if err != nil {
		t.Fatalf("Marshal(remove) error = %v", err)
	}

	request = httptest.NewRequest(
		http.MethodPost,
		"/packs/company.handler-pack/entries/remove",
		bytes.NewReader(requestBody),
	)
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("remove status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestPromptPacksHandlerCreatesLocalDraftEntry(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	store := newPromptPackHandlerTestStore(t)
	if _, err := store.CreatePack(t.Context(), promptpack.Pack{
		ID:      "company.handler-draft",
		Name:    "Handler Draft",
		Version: "1.0.0",
	}); err != nil {
		t.Fatalf("CreatePack() error = %v", err)
	}

	handler := NewPromptPacks(store)
	router := gin.New()
	router.POST("/packs/:id/entries", handler.HandleCreatePackEntry)
	body, err := json.Marshal(createPromptPackEntryRequest{
		Kind: instructionpack.KindPrompt,
		Slug: "prompt-handler-draft",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	request := httptest.NewRequest(
		http.MethodPost,
		"/packs/company.handler-draft/entries",
		bytes.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body = %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Success bool             `json:"success"`
		Data    promptpack.Entry `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if !envelope.Success || envelope.Data.Name != "未命名提示词" || envelope.Data.Body != "" {
		t.Fatalf("POST body = %s, want an empty prompt draft", response.Body.String())
	}
}

func TestPromptPacksHandlerRejectsUnsupportedPackVersion(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	store := newPromptPackHandlerTestStore(t)
	handler := NewPromptPacks(store)
	router := gin.New()
	router.POST("/packs/import", handler.HandleImportPack)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "commercial.mgpack")
	if err != nil {
		t.Fatalf("CreateFormFile() error = %v", err)
	}
	if _, err := part.Write([]byte{'M', 'G', 'P', 'K', 2}); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/packs/import", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusUnprocessableEntity, response.Body.String())
	}
	var envelope struct {
		Message string `json:"message"`
		Success bool   `json:"success"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if envelope.Success || envelope.Message != "当前构建不支持此技能包版本，请使用 MediaGo Drama 官方版导入" {
		t.Fatalf("body = %s, want unsupported-version guidance", response.Body.String())
	}
}

func newPromptPackHandlerTestStore(t *testing.T) *promptpack.Service {
	t.Helper()
	repositories, err := repository.OpenSettingsRepositories(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("OpenSettingsRepositories() error = %v", err)
	}
	sqlDB, err := repositories.DB.DB()
	if err != nil {
		t.Fatalf("DB() error = %v", err)
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	return promptpack.NewServiceFromRepository(repositories.Packs, repositories.PromptLibrary, nil)
}
