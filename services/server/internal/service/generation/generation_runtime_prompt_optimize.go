package generation

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const promptOptimizationSystemInstruction = `你是一位专业的 AI 绘画提示词优化专家。
用户会给你一段原始提示词和一段参考风格提示词，请基于参考风格的表述方式和细节维度，重写并优化原始提示词。
要求：
1. 保留原始提示词的核心意图和主体内容。
2. 融入参考风格提示词的表述技巧（如构图、光影、材质、氛围等维度的描写）。
3. 输出优化后的提示词，使用英文，不要输出任何解释或额外说明。
4. 只输出最终提示词本身。`

// NormalizeGenerationPromptOptimizationRequest trims prompt optimization settings.
func NormalizeGenerationPromptOptimizationRequest(request *GenerationPromptOptimizationRequest) *GenerationPromptOptimizationRequest {
	if request == nil {
		return nil
	}
	normalized := *request
	normalized.RouteID = strings.TrimSpace(normalized.RouteID)
	normalized.Model = strings.TrimSpace(normalized.Model)
	normalized.ReferenceName = strings.TrimSpace(normalized.ReferenceName)
	normalized.ReferencePrompt = strings.TrimSpace(normalized.ReferencePrompt)
	normalized.Params = NormalizeGenerationParams(normalized.Params)
	return &normalized
}

// ValidateGenerationPromptOptimizationRequest validates prompt optimization settings.
func ValidateGenerationPromptOptimizationRequest(request *GenerationPromptOptimizationRequest) error {
	if request == nil {
		return nil
	}
	if request.ReferencePrompt == "" {
		return fmt.Errorf("缺少提示词优化参考内容")
	}
	if request.RouteID == "" {
		return nil
	}
	route, ok := coregeneration.FindRoute(request.RouteID)
	if !ok {
		return fmt.Errorf("unknown generation route %q", request.RouteID)
	}
	if route.Kind != coregeneration.KindText {
		return fmt.Errorf("generation route %q is not a text route", route.ID)
	}
	return nil
}

func (workflow *GenerationService) completePromptOptimizedGeneration(
	ctx context.Context,
	task generationTaskRecord,
	route coregeneration.ModelRoute,
	provider coregeneration.Provider,
	payload generationMessageRequest,
	referenceURLs []string,
	action string,
	projectID string,
	conversationID string,
) {
	runningTask := task
	runningTask.Status = "running"
	runningTask.Message = "正在优化提示词，完成后会自动开始生成。"
	runningTask.Error = ""
	runningTask.ErrorCode = ""
	runningTask.ErrorType = ""
	runningTask.Retryable = false
	if err := workflow.generationTasks.Upsert(runningTask); err != nil {
		slog.Error("prompt optimization task running state could not be saved", "task_id", task.ID, "error", err)
		return
	}
	workflow.syncGenerationNotificationTask(runningTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, "optimize", runningTask.Status, runningTask.Message, nil)

	optimizedPrompt, err := workflow.CompleteText(ctx, TextCompletionRequest{
		Prompt:  promptOptimizationUserPrompt(payload.PromptOptimization, payload.Prompt),
		RouteID: payload.PromptOptimization.RouteID,
		Model:   payload.PromptOptimization.Model,
		Params:  promptOptimizationParams(payload.PromptOptimization.Params),
	})
	if err != nil {
		workflow.failPromptOptimizedGeneration(runningTask, err, "optimize")
		return
	}
	optimizedPrompt = strings.TrimSpace(optimizedPrompt)
	if optimizedPrompt == "" {
		workflow.failPromptOptimizedGeneration(runningTask, fmt.Errorf("提示词优化未返回内容"), "optimize")
		return
	}

	payload.Prompt = optimizedPrompt
	optimizedTask := runningTask
	optimizedTask.Prompt = optimizedPrompt
	optimizedTask.Message = "提示词优化完成，正在生成。"
	if err := workflow.generationTasks.Upsert(optimizedTask); err != nil {
		slog.Error("optimized prompt could not be saved", "task_id", task.ID, "error", err)
		return
	}
	workflow.syncGenerationNotificationTask(optimizedTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, "optimize", optimizedTask.Status, optimizedTask.Message, nil)

	generationRequest := GenerationRequestFromMessage(payload, route, referenceURLs)
	generationRequest.Prompt = workflow.providerPromptForGeneration(route, payload)
	if ShouldSubmitGenerationInBackground(route) {
		workflow.submitPendingGeneration(ctx, optimizedTask, provider, generationRequest, action, projectID, conversationID)
		return
	}
	if ShouldRunGenerationInBackground(route) {
		workflow.completeSubmittedGeneration(ctx, optimizedTask, provider, generationRequest, action, projectID, conversationID)
		return
	}

	workflow.completePromptOptimizedGenerationSync(ctx, optimizedTask, provider, generationRequest, action, projectID, conversationID)
}

func promptOptimizationUserPrompt(request *GenerationPromptOptimizationRequest, currentPrompt string) string {
	referenceName := "参考提示词"
	if request != nil && request.ReferenceName != "" {
		referenceName = request.ReferenceName
	}
	referencePrompt := ""
	if request != nil {
		referencePrompt = request.ReferencePrompt
	}
	currentPrompt = strings.TrimSpace(currentPrompt)
	if currentPrompt == "" {
		currentPrompt = "（空）"
	}
	return strings.Join([]string{
		fmt.Sprintf("参考风格提示词（来自「%s」）：", referenceName),
		referencePrompt,
		"",
		"需要优化的原始提示词：",
		currentPrompt,
	}, "\n")
}

func promptOptimizationParams(params map[string]any) map[string]any {
	next := make(map[string]any, len(params)+1)
	for key, value := range params {
		next[key] = value
	}
	next["system_instruction"] = promptOptimizationSystemInstruction
	return next
}

func (workflow *GenerationService) completePromptOptimizedGenerationSync(
	ctx context.Context,
	task generationTaskRecord,
	provider coregeneration.Provider,
	request coregeneration.Request,
	action string,
	projectID string,
	conversationID string,
) {
	generationCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()

	response, err := workflow.generateWithProvider(
		generationCtx,
		provider,
		request,
		generationProviderLogContext{Action: action, TaskID: task.ID},
	)
	if err != nil {
		workflow.failPromptOptimizedGeneration(task, err, action)
		return
	}

	assetTitle := generationAssetTitleFromRequest(request)
	response = workflow.cacheGenerationResponseAssetsWithOptions(ctx, response, generationMediaSaveOptionsWithTitle(projectID, conversationID, task.SectionID, assetTitle))
	messageResponse := generationResponseWithAssetTitle(GenerationResponseFromCore(response, task.Kind), assetTitle)
	messageResponse.ID = task.ID
	completedTask := GenerationTaskWithMessage(task, messageResponse)
	if err := workflow.generationTasks.Upsert(completedTask); err != nil {
		slog.Error("prompt optimized generation completion could not be saved", "task_id", task.ID, "error", err)
		return
	}
	workflow.syncGenerationNotificationTask(completedTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, action, messageResponse.Status, messageResponse.Message, nil)
	if conversation, ok, err := workflow.generationTasks.GetConversation(task.ConversationID); err == nil && ok {
		workflow.appendStudioAssistantTranscript(conversation, messageResponse)
	}
}

func (workflow *GenerationService) failPromptOptimizedGeneration(task generationTaskRecord, err error, action string) {
	messageResponse := FailedGenerationResponse(task.ID, err)
	failedTask := GenerationTaskWithMessage(task, messageResponse)
	if saveErr := workflow.generationTasks.Upsert(failedTask); saveErr != nil {
		slog.Error("prompt optimized generation failure could not be saved", "task_id", task.ID, "error", saveErr)
		return
	}
	workflow.syncGenerationNotificationTask(failedTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, action, messageResponse.Status, messageResponse.Message, err)
	if conversation, ok, getErr := workflow.generationTasks.GetConversation(task.ConversationID); getErr == nil && ok {
		workflow.appendStudioAssistantTranscript(conversation, messageResponse)
	}
}
