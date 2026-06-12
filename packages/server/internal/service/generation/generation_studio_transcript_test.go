package generation

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/repository"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/media"
)

func TestAppendStudioTranscriptWritesJSONLAndTextResult(t *testing.T) {
	workspaceRoot := t.TempDir()
	mediaRepo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	mediaAssets := media.NewMediaAssetsFromRepository(
		mediaRepo,
		filepath.Join(workspaceRoot, "library", "assets", "generated"),
		workspaceRoot,
		nil,
		nil,
	)
	workflow := NewGenerationService(nil, nil, mediaAssets)
	conversation := GenerationConversationRecord{
		ID:        "session-text-1",
		ScopeID:   defaultGenerationConversationScopeID,
		Kind:      "text",
		CreatedAt: "2026-06-06T12:00:00Z",
	}

	workflow.appendStudioUserTranscript(conversation, GenerationMessageRequest{
		Kind:   "text",
		Prompt: "写一段开场白",
	})
	workflow.appendStudioAssistantTranscript(conversation, GenerationMessageResponse{
		ID:     "generation-1",
		Status: "completed",
		Text:   "夜色落下。",
	})

	sessionDir := filepath.Join(workspaceRoot, "studio", "text-generation", "2026-06", "session-text-1")
	transcriptPath := filepath.Join(sessionDir, "transcript.jsonl")
	data, err := os.ReadFile(transcriptPath)
	if err != nil {
		t.Fatalf("reading transcript: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("transcript lines = %d, want 2: %s", len(lines), string(data))
	}
	if !strings.Contains(lines[0], `"role":"user"`) || !strings.Contains(lines[0], "写一段开场白") {
		t.Fatalf("user line = %s, want user prompt", lines[0])
	}
	if !strings.Contains(lines[1], `"role":"assistant"`) || !strings.Contains(lines[1], "夜色落下。") {
		t.Fatalf("assistant line = %s, want assistant text", lines[1])
	}
	textPath := filepath.Join(sessionDir, "generation-1.txt")
	text, err := os.ReadFile(textPath)
	if err != nil {
		t.Fatalf("reading text result: %v", err)
	}
	if string(text) != "夜色落下。" {
		t.Fatalf("text result = %q, want assistant text", string(text))
	}
}

func TestStudioGenerationAssetUsesGenerationSessionDir(t *testing.T) {
	workspaceRoot := t.TempDir()
	generationTasks := NewGenerationTaskService(filepath.Join(t.TempDir(), "settings.db"), nil)
	conversation := GenerationConversationRecord{
		ID:        "session-image-1",
		ScopeID:   defaultGenerationConversationScopeID,
		Kind:      "image",
		CreatedAt: "2026-06-06T12:00:00Z",
		Title:     "图片生成会话",
	}
	if err := generationTasks.UpsertConversation(conversation); err != nil {
		t.Fatalf("UpsertConversation() error = %v", err)
	}

	mediaRepo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "media.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	mediaAssets := media.NewMediaAssetsFromRepository(
		mediaRepo,
		filepath.Join(workspaceRoot, "library", "assets", "generated"),
		workspaceRoot,
		nil,
		nil,
	)
	workflow := NewGenerationService(nil, generationTasks, mediaAssets)

	asset, err := workflow.saveGenerationBase64Asset(
		media.MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		"",
		conversation.ID,
	)
	if err != nil {
		t.Fatalf("saveGenerationBase64Asset() error = %v", err)
	}

	wantDir := filepath.Join(workspaceRoot, "studio", "image-generation", "2026-06", "session-image-1")
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("studio generation asset dir = %q, want %q", got, wantDir)
	}
}

func TestAgentGenerationAssetUsesGenerationSessionDir(t *testing.T) {
	workspaceRoot := t.TempDir()
	generationTasks := NewGenerationTaskService(filepath.Join(t.TempDir(), "settings.db"), nil)
	conversation := GenerationConversationRecord{
		ID:        "project-alpha",
		ScopeID:   agentGenerationConversationScopeID,
		Kind:      "image",
		CreatedAt: "2026-06-06T12:00:00Z",
		Title:     "项目 Alpha",
	}
	if err := generationTasks.UpsertConversation(conversation); err != nil {
		t.Fatalf("UpsertConversation() error = %v", err)
	}

	mediaRepo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "media.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	mediaAssets := media.NewMediaAssetsFromRepository(
		mediaRepo,
		filepath.Join(workspaceRoot, "library", "assets", "generated"),
		workspaceRoot,
		nil,
		nil,
	)
	workflow := NewGenerationService(nil, generationTasks, mediaAssets)

	asset, err := workflow.saveGenerationBase64Asset(
		media.MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		"",
		conversation.ID,
	)
	if err != nil {
		t.Fatalf("saveGenerationBase64Asset() error = %v", err)
	}

	wantDir := filepath.Join(workspaceRoot, "studio", "image-generation", "2026-06", "project-alpha")
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("agent generation asset dir = %q, want %q", got, wantDir)
	}
}
