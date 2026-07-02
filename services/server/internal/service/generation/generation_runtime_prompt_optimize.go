package generation

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const promptOptimizationSystemInstructionText = `你是提示词优化助手，负责把“用户的输入”改写成一条可直接用于生成的高质量提示词。
以“优化 prompt”为风格基准，把其中的媒介、画风和质量要求融入改写结果。
保留“用户的输入”中的主体、动作、场景等核心内容，不要引入无关的新主体。
严格保持原有媒介与画风（如 2D 动漫、插画、写实摄影等），不得改成另一种风格方向。
只输出优化后的提示词正文，不要任何解释、标题、寒暄、标签、Markdown、代码块、JSON、思考过程或额外信息。`
const promptOptimizationConversationKindLabel = "提示词生成"

// NormalizeGenerationPromptOptimizationRequest trims prompt optimization settings.
func NormalizeGenerationPromptOptimizationRequest(request *GenerationPromptOptimizationRequest) *GenerationPromptOptimizationRequest {
	if request == nil {
		return nil
	}
	normalized := *request
	normalized.ConversationID = strings.TrimSpace(normalized.ConversationID)
	normalized.ScopeID = strings.TrimSpace(normalized.ScopeID)
	normalized.ConversationTitle = strings.TrimSpace(normalized.ConversationTitle)
	normalized.ProjectID = GenerationProjectIDForRequest(normalized.ProjectID, "")
	normalized.CapabilityID = strings.TrimSpace(normalized.CapabilityID)
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

// CreatePromptOptimizedGenerationMessage optimizes a prompt through a persisted
// text generation task, then submits media generation with the optimized prompt.
func (workflow *GenerationService) CreatePromptOptimizedGenerationMessage(
	ctx context.Context,
	payload generationMessageRequest,
) (GenerationOptimizeAndGenerateResponse, int, error) {
	payload.Kind = strings.TrimSpace(payload.Kind)
	payload.ConversationID = strings.TrimSpace(payload.ConversationID)
	hasScopeFilter := strings.TrimSpace(payload.ScopeID) != ""
	payload.ScopeID = NormalizeGenerationConversationScopeID(payload.ScopeID)
	payload.ProjectID = GenerationProjectIDForRequest(payload.ProjectID, "")
	if payload.ProjectID == "" && payload.NotificationTarget != nil {
		payload.ProjectID = GenerationProjectIDForRequest(payload.NotificationTarget.ProjectID, "")
	}
	payload.Prompt = strings.TrimSpace(payload.Prompt)
	payload.RouteID = strings.TrimSpace(payload.RouteID)
	payload.FamilyID = strings.TrimSpace(payload.FamilyID)
	payload.VersionID = strings.TrimSpace(payload.VersionID)
	payload.Provider = strings.TrimSpace(payload.Provider)
	payload.ModelID = strings.TrimSpace(payload.ModelID)
	payload.Model = strings.TrimSpace(payload.Model)
	payload.AssetTitle = strings.TrimSpace(payload.AssetTitle)
	payload.ReferenceURLs = CompactStrings(payload.ReferenceURLs)
	payload.ReferenceAssetIDs = CompactStrings(payload.ReferenceAssetIDs)
	payload.ReferenceBindings = normalizeGenerationReferenceBindings(payload.ReferenceBindings)
	payload.PromptOptimization = NormalizeGenerationPromptOptimizationRequest(payload.PromptOptimization)
	if payload.PromptOptimization == nil {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 promptOptimization")
	}
	if err := ValidateGenerationPromptOptimizationRequest(payload.PromptOptimization); err != nil {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusBadRequest, err
	}
	if err := workflow.applyGenerationDocumentContext(&payload); err != nil {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusBadRequest, err
	}
	if payload.AssetTitle == "" {
		payload.AssetTitle = generationAssetTitleFromNotificationTarget(payload.NotificationTarget)
	}
	payload.ReferenceURLs = uniqueCompactStrings(payload.ReferenceURLs)
	payload.ReferenceAssetIDs = uniqueCompactStrings(payload.ReferenceAssetIDs)
	if payload.Kind == "" && payload.RouteID == "" && payload.ModelID == "" {
		payload.Kind = string(coregeneration.KindImage)
	}
	payload.Params = NormalizeGenerationParams(payload.Params)
	if payload.Prompt == "" {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 prompt")
	}

	route, err := ResolveGenerationRoute(payload)
	if err != nil {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusBadRequest, err
	}
	if route.Kind == coregeneration.KindText {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusBadRequest, fmt.Errorf("优化并生成需要图片、视频或音频生成路由")
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
		return GenerationOptimizeAndGenerateResponse{}, http.StatusServiceUnavailable, err
	}
	if _, err := workflow.resolveConfiguredTextRoute(payload.PromptOptimization.RouteID); err != nil {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusServiceUnavailable, err
	}

	conversation, status, err := workflow.resolveGenerationConversationWithScopeFilter(payload.ConversationID, payload.ScopeID, payload.Kind, hasScopeFilter)
	if err != nil {
		return GenerationOptimizeAndGenerateResponse{}, status, err
	}
	payload.ConversationID = conversation.ID
	if payload.ProjectID == "" {
		payload.ProjectID = GenerationProjectIDFromScopeID(conversation.ScopeID)
	}
	if _, err := workflow.resolveGenerationReferences(route, payload); err != nil {
		return GenerationOptimizeAndGenerateResponse{}, http.StatusBadRequest, err
	}

	optimization, optimizedPrompt, status, err := workflow.createPromptOptimizationHistoryTask(ctx, payload, conversation)
	if err != nil {
		return GenerationOptimizeAndGenerateResponse{}, status, err
	}

	generationPayload := payload
	generationPayload.Prompt = optimizedPrompt
	generationPayload.PromptOptimization = nil
	if !hasScopeFilter {
		generationPayload.ScopeID = ""
	}
	generationResponse, status, err := workflow.CreateGenerationMessage(ctx, generationPayload)
	if err != nil {
		return GenerationOptimizeAndGenerateResponse{}, status, err
	}

	return GenerationOptimizeAndGenerateResponse{
		Optimization:    optimization,
		Generation:      generationResponse,
		OptimizedPrompt: optimizedPrompt,
	}, http.StatusOK, nil
}

func (workflow *GenerationService) createPromptOptimizationHistoryTask(
	ctx context.Context,
	generationPayload generationMessageRequest,
	generationConversation GenerationConversationRecord,
) (GenerationMessageResponse, string, int, error) {
	optimization := generationPayload.PromptOptimization
	if optimization == nil {
		return GenerationMessageResponse{}, "", http.StatusBadRequest, fmt.Errorf("缺少 promptOptimization")
	}

	conversationID := strings.TrimSpace(optimization.ConversationID)
	scopeID := strings.TrimSpace(optimization.ScopeID)
	if scopeID == "" {
		scopeID = generationConversation.ScopeID
	}
	scopeID = NormalizeGenerationConversationScopeID(scopeID)
	projectID := GenerationProjectIDForRequest(optimization.ProjectID, "")
	if projectID == "" {
		projectID = generationPayload.ProjectID
	}
	conversationTitle := strings.TrimSpace(optimization.ConversationTitle)
	if conversationID == "" && projectID != "" {
		conversationID = projectID + "-text"
		if scopeID == defaultGenerationConversationScopeID {
			scopeID = agentGenerationConversationScopeID
		}
	}
	if conversationID != "" && conversationTitle == "" {
		conversationTitle = promptOptimizationConversationTitle(projectID)
	}
	if conversationID != "" {
		if _, status, err := workflow.CreateGenerationConversation(CreateGenerationConversationRequest{
			ID:      conversationID,
			ScopeID: scopeID,
			Kind:    string(coregeneration.KindText),
			Title:   conversationTitle,
		}); err != nil {
			return GenerationMessageResponse{}, "", status, err
		}
	}

	textPayload := generationMessageRequest{
		Kind:              string(coregeneration.KindText),
		ConversationID:    conversationID,
		ScopeID:           scopeID,
		ProjectID:         projectID,
		DocumentID:        generationPayload.DocumentID,
		SectionID:         generationPayload.SectionID,
		CapabilityID:      firstNonEmpty(optimization.CapabilityID, generationPayload.CapabilityID),
		RouteID:           optimization.RouteID,
		Model:             optimization.Model,
		Prompt:            promptOptimizationUserPrompt(optimization, generationPayload.Prompt),
		Params:            promptOptimizationParams(optimization.Params),
		ReferenceURLs:     []string{},
		ReferenceAssetIDs: []string{},
	}

	var finalMessage *GenerationMessageResponse
	var failedMessage string
	status, err := workflow.StreamGenerationText(ctx, textPayload, func(event GenerationTextStreamEvent) error {
		if event.Type == "done" && event.Message != nil {
			message := *event.Message
			finalMessage = &message
		}
		if event.Type == "error" {
			failedMessage = strings.TrimSpace(event.Error)
		}
		return nil
	})
	if err != nil {
		return GenerationMessageResponse{}, "", status, err
	}
	if finalMessage == nil {
		if failedMessage == "" {
			failedMessage = "提示词优化未返回内容"
		}
		return GenerationMessageResponse{}, "", http.StatusBadGateway, fmt.Errorf("%s", failedMessage)
	}
	optimizedPrompt := cleanPromptOptimizationOutput(finalMessage.Text)
	if optimizedPrompt == "" {
		optimizedPrompt = cleanPromptOptimizationOutput(finalMessage.Message)
	}
	if optimizedPrompt == "" {
		return *finalMessage, "", http.StatusBadGateway, fmt.Errorf("提示词优化未返回内容")
	}
	finalMessage.Text = optimizedPrompt
	if task, ok, err := workflow.generationTasks.Get(finalMessage.ID); err == nil && ok {
		if err := workflow.generationTasks.Upsert(GenerationTaskWithMessage(task, *finalMessage)); err != nil {
			finalMessage.Message = AppendStorageWarning(finalMessage.Message, err)
		}
	}
	return *finalMessage, optimizedPrompt, http.StatusOK, nil
}

func promptOptimizationConversationTitle(projectID string) string {
	projectName := strings.TrimSpace(projectID)
	if projectName == "" {
		projectName = "项目"
	}
	return projectName + " · " + promptOptimizationConversationKindLabel
}

func promptOptimizationUserPrompt(request *GenerationPromptOptimizationRequest, currentPrompt string) string {
	current := strings.TrimSpace(currentPrompt)
	referencePrompt := ""
	if request != nil {
		referencePrompt = strings.TrimSpace(request.ReferencePrompt)
	}
	return strings.TrimSpace(fmt.Sprintf(`优化 prompt：
%s

用户的输入：
%s

请按“优化 prompt”的风格和质量要求改写“用户的输入”，只输出优化后的提示词正文，不要任何解释或额外内容。`, referencePrompt, current))
}

func cleanPromptOptimizationOutput(value string) string {
	text := strings.TrimSpace(stripPromptOptimizationThinkTags(value))
	text = stripPromptOptimizationCodeFence(text)
	text = stripPromptOptimizationLabel(text)
	text = stripPromptOptimizationCodeFence(text)
	return strings.TrimSpace(text)
}

var (
	promptOptimizationThinkPattern     = regexp.MustCompile(`(?is)<think>.*?</think>`)
	promptOptimizationOpenThinkPattern = regexp.MustCompile(`(?is)<think>.*$`)
	promptOptimizationOpenFencePattern = regexp.MustCompile("^```[^\n]*\n")
	promptOptimizationLabelPattern     = regexp.MustCompile(`(?i)^[#*\s>_-]*(?:优化后的?提示词|优化后 prompt|optimized prompt|优化 prompt|提示词|prompt)\s*[:：]\s*[*\s]*`)
)

func stripPromptOptimizationThinkTags(value string) string {
	text := promptOptimizationThinkPattern.ReplaceAllString(value, "")
	return promptOptimizationOpenThinkPattern.ReplaceAllString(text, "")
}

// stripPromptOptimizationCodeFence also strips an unterminated opening fence to
// stay consistent with the frontend streaming cleaner.
func stripPromptOptimizationCodeFence(value string) string {
	text := strings.TrimSpace(value)
	if !strings.HasPrefix(text, "```") {
		return text
	}
	if !strings.Contains(text, "\n") {
		return ""
	}
	text = promptOptimizationOpenFencePattern.ReplaceAllString(text, "")
	text = strings.TrimSuffix(text, "\n```")
	return strings.TrimSpace(text)
}

func stripPromptOptimizationLabel(value string) string {
	text := strings.TrimSpace(value)
	for {
		next := strings.TrimSpace(promptOptimizationLabelPattern.ReplaceAllString(text, ""))
		if next == text {
			return text
		}
		text = next
	}
}

func promptOptimizationParams(params map[string]any) map[string]any {
	next := make(map[string]any, len(params)+1)
	for key, value := range params {
		next[key] = value
	}
	if instruction := promptOptimizationSystemInstruction(); instruction != "" {
		next["system_instruction"] = instruction
	}
	return next
}

func promptOptimizationSystemInstruction() string {
	return promptOptimizationSystemInstructionText
}
