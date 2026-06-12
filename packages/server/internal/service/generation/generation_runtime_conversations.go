package generation

import (
	"fmt"
	"net/http"
	"strings"

	coregeneration "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
)

// ListGenerationConversations lists generation conversations for HTTP handlers.
func (workflow *GenerationService) ListGenerationConversations(scopeID string, kind string) (GenerationConversationsResponse, error) {
	hasScopeFilter := strings.TrimSpace(scopeID) != ""
	if hasScopeFilter {
		scopeID = NormalizeGenerationConversationScopeID(scopeID)
	}
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = string(coregeneration.KindImage)
	}
	if !hasScopeFilter {
		scopeID = ""
	}
	conversations, err := workflow.generationTasks.ListConversations(scopeID, kind)
	if err != nil {
		return GenerationConversationsResponse{}, err
	}
	userConversations := make([]GenerationConversationRecord, 0, len(conversations))
	for _, conversation := range conversations {
		if conversation.Default {
			continue
		}
		userConversations = append(userConversations, conversation)
	}
	return GenerationConversationsResponse{Conversations: userConversations}, nil
}

// CreateGenerationConversation creates a generation conversation for HTTP handlers.
func (workflow *GenerationService) CreateGenerationConversation(payload CreateGenerationConversationRequest) (GenerationConversationRecord, int, error) {
	scopeID := NormalizeGenerationConversationScopeID(payload.ScopeID)
	kind := strings.TrimSpace(payload.Kind)
	if kind == "" {
		return GenerationConversationRecord{}, http.StatusBadRequest, fmt.Errorf("generation kind is required")
	}
	if kind != string(coregeneration.KindImage) && kind != string(coregeneration.KindVideo) && kind != string(coregeneration.KindText) {
		return GenerationConversationRecord{}, http.StatusBadRequest, fmt.Errorf("unsupported generation kind")
	}
	title := strings.TrimSpace(payload.Title)
	if title == "" {
		return GenerationConversationRecord{}, http.StatusBadRequest, fmt.Errorf("generation conversation title is required")
	}
	id := strings.TrimSpace(payload.ID)
	if id != "" {
		id = domain.CleanProjectID(id)
		if id == "" {
			return GenerationConversationRecord{}, http.StatusBadRequest, fmt.Errorf("generation conversation id is invalid")
		}
	} else {
		generatedID, err := workflow.generationTasks.idGenerator("session")
		if err != nil {
			return GenerationConversationRecord{}, http.StatusInternalServerError, err
		}
		id = generatedID
	}
	conversation := GenerationConversationRecord{
		ID:      id,
		ScopeID: scopeID,
		Kind:    kind,
		Title:   title,
	}
	if err := workflow.generationTasks.UpsertConversation(conversation); err != nil {
		return GenerationConversationRecord{}, http.StatusInternalServerError, err
	}
	stored, ok, err := workflow.generationTasks.GetConversation(id)
	if err != nil {
		return GenerationConversationRecord{}, http.StatusInternalServerError, err
	}
	if !ok {
		_ = workflow.ensureStudioSessionDir(conversation)
		return conversation, http.StatusOK, nil
	}
	_ = workflow.ensureStudioSessionDir(stored)
	return stored, http.StatusOK, nil
}

// DeleteGenerationConversation deletes a user-created generation conversation.
func (workflow *GenerationService) DeleteGenerationConversation(id string) (bool, error) {
	return workflow.generationTasks.DeleteConversation(id)
}

func (workflow *GenerationService) resolveGenerationConversation(conversationID string, scopeID string, kind string) (GenerationConversationRecord, int, error) {
	return workflow.resolveGenerationConversationWithScopeFilter(conversationID, scopeID, kind, true)
}

func (workflow *GenerationService) resolveGenerationConversationWithScopeFilter(conversationID string, scopeID string, kind string, hasScopeFilter bool) (GenerationConversationRecord, int, error) {
	scopeID = NormalizeGenerationConversationScopeID(scopeID)
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = string(coregeneration.KindImage)
	}
	if kind != string(coregeneration.KindImage) && kind != string(coregeneration.KindVideo) && kind != string(coregeneration.KindText) {
		return GenerationConversationRecord{}, http.StatusBadRequest, fmt.Errorf("unsupported generation kind")
	}

	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return GenerationConversationRecord{
			ID:      DefaultGenerationConversationID(scopeID, kind),
			ScopeID: scopeID,
			Kind:    kind,
		}, http.StatusOK, nil
	}

	conversation, ok, err := workflow.generationTasks.GetConversation(conversationID)
	if err != nil {
		return GenerationConversationRecord{}, http.StatusInternalServerError, err
	}
	if ok {
		if hasScopeFilter && conversation.ScopeID != scopeID {
			return GenerationConversationRecord{}, http.StatusBadRequest, fmt.Errorf("generation conversation scope does not match request scope")
		}
		if conversation.Kind != kind {
			return GenerationConversationRecord{}, http.StatusBadRequest, fmt.Errorf("generation conversation kind does not match request kind")
		}
		return conversation, http.StatusOK, nil
	}
	if !hasScopeFilter {
		// v1 路由的 sessionId 同时承载会话 ID 与 scope：未命中已命名会话时，
		// 把 sessionId 当作 scope，落到该 scope 的默认会话，保证按 scope（如文档章节）隔离。
		if IsDefaultGenerationConversationID(conversationID) {
			return GenerationConversationRecord{
				ID:      conversationID,
				ScopeID: scopeID,
				Kind:    kind,
			}, http.StatusOK, nil
		}
		sessionScopeID := GenerationScopeIDForSessionID(conversationID)
		return GenerationConversationRecord{
			ID:      DefaultGenerationConversationID(sessionScopeID, kind),
			ScopeID: sessionScopeID,
			Kind:    kind,
		}, http.StatusOK, nil
	}
	return GenerationConversationRecord{}, http.StatusNotFound, fmt.Errorf("generation conversation not found")
}
