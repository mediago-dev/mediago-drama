package generation

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

const (
	maxGenerationBatchItems          = 50
	generationBatchSubmitConcurrency = 3
)

// CreateGenerationBatch submits multiple generation requests through the normal generation path.
func (workflow *GenerationService) CreateGenerationBatch(ctx context.Context, payload GenerationBatchRequest) (GenerationBatchResponse, int, error) {
	if workflow == nil || workflow.generationTasks == nil {
		return GenerationBatchResponse{}, http.StatusInternalServerError, fmt.Errorf("generation task service is unavailable")
	}
	items, err := normalizeGenerationBatchItems(payload.Items)
	if err != nil {
		return GenerationBatchResponse{}, http.StatusBadRequest, err
	}
	payload.Kind = strings.TrimSpace(payload.Kind)
	payload.ConversationID = strings.TrimSpace(payload.ConversationID)
	payload.ConversationTitle = strings.TrimSpace(payload.ConversationTitle)
	payload.ScopeID = strings.TrimSpace(payload.ScopeID)
	payload.ProjectID = strings.TrimSpace(payload.ProjectID)
	if payload.ConversationID != "" {
		if payload.Kind == "" {
			return GenerationBatchResponse{}, http.StatusBadRequest, fmt.Errorf("generation batch kind is required with sessionId")
		}
		for _, item := range items {
			itemKind := strings.TrimSpace(item.Request.Kind)
			if itemKind != "" && itemKind != payload.Kind {
				return GenerationBatchResponse{}, http.StatusBadRequest, fmt.Errorf("generation batch item %q kind does not match batch kind", item.ID)
			}
		}
		if payload.ConversationTitle == "" {
			payload.ConversationTitle = "批量生成"
		}
		if _, status, err := workflow.CreateGenerationConversation(CreateGenerationConversationRequest{
			ID:      payload.ConversationID,
			ScopeID: payload.ScopeID,
			Kind:    payload.Kind,
			Title:   payload.ConversationTitle,
		}); err != nil {
			return GenerationBatchResponse{}, status, err
		}
	}
	batchID, err := workflow.generationTasks.idGenerator("generation-batch")
	if err != nil {
		return GenerationBatchResponse{}, http.StatusInternalServerError, fmt.Errorf("creating generation batch id: %w", err)
	}
	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return GenerationBatchResponse{}, http.StatusInternalServerError, fmt.Errorf("creating generation batch id: empty id")
	}

	results := make([]GenerationBatchItemResponse, len(items))
	semaphore := make(chan struct{}, min(generationBatchSubmitConcurrency, len(items)))
	var waitGroup sync.WaitGroup
	for index := range items {
		index := index
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			results[index] = workflow.submitGenerationBatchItem(ctx, batchID, index, payload, items[index])
		}()
	}
	waitGroup.Wait()

	response := GenerationBatchResponse{
		ID:     batchID,
		Status: "submitted",
		Total:  len(results),
		Items:  results,
	}
	allCompleted := true
	for _, item := range results {
		if item.TaskID == "" || isFailedGenerationBatchStatus(item.Status) {
			response.Failed++
			allCompleted = false
			continue
		}
		response.Accepted++
		if !isCompletedGenerationTaskStatus(item.Status) {
			allCompleted = false
		}
	}
	switch {
	case response.Accepted == 0:
		response.Status = "failed"
	case response.Failed > 0:
		response.Status = "partial"
	case allCompleted:
		response.Status = "completed"
	}
	return response, http.StatusOK, nil
}

// GetGenerationBatch returns the current child tasks for a persisted batch.
func (workflow *GenerationService) GetGenerationBatch(batchID string) (GenerationBatchTasksResponse, bool, error) {
	if workflow == nil || workflow.generationTasks == nil {
		return GenerationBatchTasksResponse{}, false, fmt.Errorf("generation task service is unavailable")
	}
	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return GenerationBatchTasksResponse{}, false, nil
	}
	tasks, err := workflow.generationTasks.ListByBatch(batchID)
	if err != nil {
		return GenerationBatchTasksResponse{}, false, err
	}
	if len(tasks) == 0 {
		return GenerationBatchTasksResponse{}, false, nil
	}
	response := GenerationBatchTasksResponse{
		ID:     batchID,
		Status: "completed",
		Total:  len(tasks),
		Tasks:  GenerationTasksForClient(tasks),
	}
	for _, task := range tasks {
		switch {
		case IsActiveGenerationStatus(task.Status):
			response.Active++
		case isCompletedGenerationTaskStatus(task.Status):
			response.Completed++
		default:
			response.Failed++
		}
	}
	switch {
	case response.Active > 0:
		response.Status = "running"
	case response.Completed == 0:
		response.Status = "failed"
	case response.Failed > 0:
		response.Status = "partial"
	}
	return response, true, nil
}

func (workflow *GenerationService) submitGenerationBatchItem(
	ctx context.Context,
	batchID string,
	index int,
	payload GenerationBatchRequest,
	item GenerationBatchItemRequest,
) GenerationBatchItemResponse {
	request := item.Request
	request.BatchID = batchID
	request.BatchItemID = item.ID
	request.BatchIndex = index
	if strings.TrimSpace(request.Kind) == "" {
		request.Kind = payload.Kind
	}
	if strings.TrimSpace(request.ConversationID) == "" {
		request.ConversationID = payload.ConversationID
	}
	if strings.TrimSpace(request.ProjectID) == "" {
		request.ProjectID = strings.TrimSpace(payload.ProjectID)
	}
	if strings.TrimSpace(request.ScopeID) == "" {
		request.ScopeID = strings.TrimSpace(payload.ScopeID)
	}

	result := GenerationBatchItemResponse{ID: item.ID, Index: index, Status: "failed"}
	if request.PromptOptimization != nil {
		optimized, _, err := workflow.CreatePromptOptimizedGenerationMessage(ctx, request)
		if err != nil {
			result.Error = err.Error()
			return result
		}
		result.TaskID = optimized.Generation.ID
		result.Status = optimized.Generation.Status
		result.Message = optimized.Generation.Message
		result.OptimizedPrompt = optimized.OptimizedPrompt
		result.Error = optimized.Generation.Error
		return result
	}

	response, _, err := workflow.CreateGenerationMessage(ctx, request)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.TaskID = response.ID
	result.Status = response.Status
	result.Message = response.Message
	result.Error = response.Error
	return result
}

func isFailedGenerationBatchStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "failed", "error", "cancelled", "canceled":
		return true
	default:
		return false
	}
}

func normalizeGenerationBatchItems(items []GenerationBatchItemRequest) ([]GenerationBatchItemRequest, error) {
	if len(items) == 0 {
		return nil, fmt.Errorf("generation batch requires at least one item")
	}
	if len(items) > maxGenerationBatchItems {
		return nil, fmt.Errorf("generation batch supports at most %d items", maxGenerationBatchItems)
	}
	normalized := make([]GenerationBatchItemRequest, len(items))
	seen := make(map[string]struct{}, len(items))
	for index, item := range items {
		item.ID = strings.TrimSpace(item.ID)
		if item.ID == "" {
			item.ID = fmt.Sprintf("item-%d", index+1)
		}
		if _, exists := seen[item.ID]; exists {
			return nil, fmt.Errorf("generation batch item id %q is duplicated", item.ID)
		}
		seen[item.ID] = struct{}{}
		normalized[index] = item
	}
	return normalized, nil
}
