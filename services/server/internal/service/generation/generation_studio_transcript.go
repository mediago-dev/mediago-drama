package generation

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

type studioTranscriptEntry struct {
	ID        string            `json:"id,omitempty"`
	Role      string            `json:"role"`
	Kind      string            `json:"kind"`
	Content   string            `json:"content,omitempty"`
	Status    string            `json:"status,omitempty"`
	Assets    []GenerationAsset `json:"assets,omitempty"`
	Files     []string          `json:"files,omitempty"`
	CreatedAt string            `json:"createdAt"`
}

func (workflow *GenerationService) appendStudioUserTranscript(conversation GenerationConversationRecord, payload GenerationMessageRequest) {
	workflow.appendStudioTranscript(conversation, studioTranscriptEntry{
		Role:    "user",
		Kind:    payload.Kind,
		Content: payload.Prompt,
	})
}

func (workflow *GenerationService) appendStudioAssistantTranscript(conversation GenerationConversationRecord, message GenerationMessageResponse) {
	entry := studioTranscriptEntry{
		ID:      message.ID,
		Role:    "assistant",
		Kind:    conversation.Kind,
		Content: strings.TrimSpace(message.Text),
		Status:  message.Status,
		Assets:  message.Assets,
	}
	if entry.Content == "" {
		entry.Content = strings.TrimSpace(message.Message)
	}
	workflow.appendStudioTranscript(conversation, entry)
}

func (workflow *GenerationService) appendStudioTranscript(conversation GenerationConversationRecord, entry studioTranscriptEntry) {
	sessionDir := workflow.ensureStudioSessionDir(conversation)
	if sessionDir == "" {
		return
	}
	if entry.CreatedAt == "" {
		entry.CreatedAt = timestamp.NowRFC3339Nano()
	}
	if entry.ID == "" {
		entry.ID = fmt.Sprintf("transcript-%d", time.Now().UnixNano())
	}
	if strings.TrimSpace(entry.Content) != "" && entry.Role == "assistant" && entry.Kind == "text" {
		if filename := writeStudioTextResult(sessionDir, entry.ID, entry.Content); filename != "" {
			entry.Files = append(entry.Files, filename)
		}
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	file, err := os.OpenFile(
		filepath.Join(sessionDir, "transcript.jsonl"),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND,
		0o600,
	)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(append(data, '\n'))
}

func (workflow *GenerationService) ensureStudioSessionDir(conversation GenerationConversationRecord) string {
	if workflow == nil || workflow.mediaAssets == nil {
		return ""
	}
	if !isFileBackedGenerationConversation(conversation) {
		return ""
	}
	workspaceRoot := workflow.mediaAssets.WorkspaceRoot()
	if strings.TrimSpace(workspaceRoot) == "" {
		return ""
	}
	sessionDir := shared.WorkspacePathsFor(workspaceRoot).StudioGenerationSessionDir(
		conversation.Kind,
		conversation.ID,
		conversation.CreatedAt,
	)
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return ""
	}
	return sessionDir
}

func writeStudioTextResult(sessionDir string, id string, content string) string {
	filename := shared.SafeFilename(domain.CleanProjectID(id))
	if filename == "" {
		filename = fmt.Sprintf("text-%d", time.Now().UnixNano())
	}
	filename += ".txt"
	if err := os.WriteFile(filepath.Join(sessionDir, filename), []byte(content), 0o600); err != nil {
		return ""
	}
	return filename
}

func isStudioGenerationConversation(conversation GenerationConversationRecord) bool {
	return strings.TrimSpace(conversation.ID) != "" &&
		strings.TrimSpace(conversation.Kind) != "" &&
		NormalizeGenerationConversationScopeID(conversation.ScopeID) == defaultGenerationConversationScopeID
}

func isFileBackedGenerationConversation(conversation GenerationConversationRecord) bool {
	scopeID := NormalizeGenerationConversationScopeID(conversation.ScopeID)
	return strings.TrimSpace(conversation.ID) != "" &&
		strings.TrimSpace(conversation.Kind) != "" &&
		(scopeID == defaultGenerationConversationScopeID || scopeID == agentGenerationConversationScopeID)
}
