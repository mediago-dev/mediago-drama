package generation

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	coregeneration "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
)

// StreamGenerationText streams a text generation request and persists the final task.
func (workflow *GenerationService) StreamGenerationText(
	ctx context.Context,
	payload GenerationMessageRequest,
	emit func(GenerationTextStreamEvent) error,
) (int, error) {
	if emit == nil {
		return http.StatusInternalServerError, fmt.Errorf("stream emitter is required")
	}

	payload.Kind = string(coregeneration.KindText)
	payload.ConversationID = strings.TrimSpace(payload.ConversationID)
	hasScopeFilter := strings.TrimSpace(payload.ScopeID) != ""
	payload.ScopeID = NormalizeGenerationConversationScopeID(payload.ScopeID)
	payload.ProjectID = GenerationProjectIDForRequest(payload.ProjectID, "")
	payload.Prompt = strings.TrimSpace(payload.Prompt)
	payload.RouteID = strings.TrimSpace(payload.RouteID)
	payload.FamilyID = strings.TrimSpace(payload.FamilyID)
	payload.VersionID = strings.TrimSpace(payload.VersionID)
	payload.Provider = strings.TrimSpace(payload.Provider)
	payload.ModelID = strings.TrimSpace(payload.ModelID)
	payload.Model = strings.TrimSpace(payload.Model)
	payload.ReferenceURLs = []string{}
	payload.ReferenceAssetIDs = []string{}
	payload.Params = NormalizeGenerationParams(payload.Params, payload.Size)
	if payload.Prompt == "" {
		return http.StatusBadRequest, fmt.Errorf("缺少 prompt")
	}

	route, err := ResolveGenerationRoute(payload)
	if err != nil {
		return http.StatusBadRequest, err
	}
	if route.Kind != coregeneration.KindText {
		return http.StatusBadRequest, fmt.Errorf("generation route is not a text route")
	}
	payload.Kind = string(route.Kind)
	payload.RouteID = route.ID
	payload.FamilyID = route.FamilyID
	payload.VersionID = route.VersionID
	payload.Provider = route.Provider
	if payload.Model == "" {
		payload.Model = route.Model
	}
	if payload.ModelID == "" {
		payload.ModelID = route.LegacyModelID
	}
	if err := workflow.requireGenerationRouteConfigured(route); err != nil {
		return http.StatusServiceUnavailable, err
	}

	conversation, status, err := workflow.resolveGenerationConversationWithScopeFilter(payload.ConversationID, payload.ScopeID, payload.Kind, hasScopeFilter)
	if err != nil {
		return status, err
	}
	payload.ConversationID = conversation.ID
	if payload.ProjectID == "" {
		payload.ProjectID = GenerationProjectIDFromScopeID(conversation.ScopeID)
	}
	workflow.appendStudioUserTranscript(conversation, payload)

	provider, err := workflow.newGenerationProvider(route)
	if err != nil {
		return http.StatusServiceUnavailable, err
	}

	taskID, err := workflow.generationTasks.idGenerator("generation")
	if err != nil {
		return http.StatusInternalServerError, err
	}
	initialResponse := GenerationMessageResponse{
		ID:      taskID,
		Role:    "assistant",
		Status:  "running",
		Message: "文本生成中...",
		Assets:  []GenerationAsset{},
		Usage:   GenerationUsage{},
	}
	task := GenerationTaskFromMessage(payload, route, initialResponse)
	if err := workflow.generationTasks.Upsert(task); err != nil {
		return http.StatusInternalServerError, err
	}
	_ = workflow.generationTasks.RecordAttempt(task.ID, "create", task.Status, task.Message, nil)

	if err := emit(GenerationTextStreamEvent{
		Type:           "start",
		TaskID:         task.ID,
		ConversationID: conversation.ID,
		Status:         task.Status,
		Message:        &initialResponse,
	}); err != nil {
		return http.StatusOK, err
	}

	runCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()

	generationRequest := GenerationRequestFromMessage(payload, route, nil)
	streamProvider, ok := provider.(coregeneration.TextStreamProvider)
	if !ok {
		return workflow.generateGenerationTextWithoutStream(
			runCtx,
			provider,
			generationRequest,
			task,
			conversation,
			emit,
		)
	}
	stream, err := streamProvider.GenerateTextStream(runCtx, generationRequest)
	if err != nil {
		if errors.Is(err, coregeneration.ErrTextStreamingUnsupported) {
			return workflow.generateGenerationTextWithoutStream(
				runCtx,
				provider,
				generationRequest,
				task,
				conversation,
				emit,
			)
		}
		message := workflow.persistTextStreamFailure(task, "", err)
		workflow.appendStudioAssistantTranscript(conversation, message)
		return http.StatusOK, emit(GenerationTextStreamEvent{
			Type:           "error",
			TaskID:         task.ID,
			ConversationID: conversation.ID,
			Status:         "failed",
			Error:          err.Error(),
		})
	}
	defer stream.Close()

	var builder strings.Builder
	usage := GenerationUsage{}
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			partialText := builder.String()
			message := workflow.persistTextStreamFailure(task, partialText, err)
			workflow.appendStudioAssistantTranscript(conversation, message)
			return http.StatusOK, emit(GenerationTextStreamEvent{
				Type:           "error",
				TaskID:         task.ID,
				ConversationID: conversation.ID,
				Status:         "failed",
				Error:          err.Error(),
			})
		}
		if event.Usage != nil {
			usage = GenerationUsage{
				InputTokens:     event.Usage.InputTokens,
				OutputTokens:    event.Usage.OutputTokens,
				TotalTokens:     event.Usage.TotalTokens,
				ReasoningTokens: event.Usage.ReasoningTokens,
				CachedTokens:    event.Usage.CachedTokens,
			}
		}
		if event.Delta != "" {
			builder.WriteString(event.Delta)
			if err := emit(GenerationTextStreamEvent{
				Type:           "delta",
				TaskID:         task.ID,
				ConversationID: conversation.ID,
				Delta:          event.Delta,
				Status:         "running",
			}); err != nil {
				return http.StatusOK, err
			}
		}
		if event.Done {
			break
		}
	}

	text := builder.String()
	message := "文本生成已完成。"
	if strings.TrimSpace(text) == "" {
		message = "文本生成已完成，但未返回文本。"
	}
	completedResponse := GenerationMessageResponse{
		ID:      task.ID,
		Role:    "assistant",
		Status:  "completed",
		Message: message,
		Text:    text,
		Assets:  []GenerationAsset{},
		Usage:   usage,
	}
	return workflow.finishGenerationTextTask(task, conversation, completedResponse, emit)
}

func (workflow *GenerationService) persistTextStreamFailure(task GenerationTaskRecord, partialText string, failure error) GenerationMessageResponse {
	messageResponse := FailedGenerationResponse(task.ID, failure)
	messageResponse.Text = partialText
	failedTask := GenerationTaskWithMessage(task, messageResponse)
	if err := workflow.generationTasks.Upsert(failedTask); err != nil {
		slog.Error("generation text stream failure could not be saved", "task_id", task.ID, "error", err)
		return messageResponse
	}
	_ = workflow.generationTasks.RecordAttempt(task.ID, "create", messageResponse.Status, messageResponse.Message, failure)
	return messageResponse
}

func (workflow *GenerationService) generateGenerationTextWithoutStream(
	ctx context.Context,
	provider coregeneration.Provider,
	request coregeneration.Request,
	task GenerationTaskRecord,
	conversation GenerationConversationRecord,
	emit func(GenerationTextStreamEvent) error,
) (int, error) {
	response, err := workflow.generateWithProvider(
		ctx,
		provider,
		request,
		generationProviderLogContext{Action: "create", TaskID: task.ID},
	)
	if err != nil {
		message := workflow.persistTextStreamFailure(task, "", err)
		workflow.appendStudioAssistantTranscript(conversation, message)
		return http.StatusOK, emit(GenerationTextStreamEvent{
			Type:           "error",
			TaskID:         task.ID,
			ConversationID: conversation.ID,
			Status:         "failed",
			Error:          err.Error(),
		})
	}

	response.ID = task.ID
	completedResponse := GenerationResponseFromCore(response, string(coregeneration.KindText))
	completedResponse.ID = task.ID
	return workflow.finishGenerationTextTask(task, conversation, completedResponse, emit)
}

func (workflow *GenerationService) finishGenerationTextTask(
	task GenerationTaskRecord,
	conversation GenerationConversationRecord,
	completedResponse GenerationMessageResponse,
	emit func(GenerationTextStreamEvent) error,
) (int, error) {
	completedTask := GenerationTaskWithMessage(task, completedResponse)
	if err := workflow.generationTasks.Upsert(completedTask); err != nil {
		completedResponse.Message = AppendStorageWarning(completedResponse.Message, err)
	} else {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "create", completedResponse.Status, completedResponse.Message, nil)
	}
	workflow.appendStudioAssistantTranscript(conversation, completedResponse)

	return http.StatusOK, emit(GenerationTextStreamEvent{
		Type:           "done",
		TaskID:         task.ID,
		ConversationID: conversation.ID,
		Status:         completedResponse.Status,
		Message:        &completedResponse,
		Usage:          &completedResponse.Usage,
	})
}
