package generation

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const defaultGenerationConversationScopeID = "studio"
const agentGenerationConversationScopeID = "agent"
const generationProjectScopePrefix = "project-"
const generationInternalParamPrefix = "_mediago_"
const generationAssetTitleRequestOption = "_mediago_asset_title"

var generationConversationIDPartPattern = regexp.MustCompile(`[^a-z0-9_-]+`)

// GenerationResponseFromCore maps a core generation response to the API response.
func GenerationResponseFromCore(response coregeneration.Response, kind string) GenerationMessageResponse {
	assets := make([]GenerationAsset, 0, len(response.Assets))
	for _, asset := range response.Assets {
		if asset.URL == "" && asset.Base64 == "" {
			continue
		}
		assets = append(assets, GenerationAsset{
			AssetID:      libraryAssetIDFromGenerationAssetURL(asset.URL),
			Kind:         string(asset.Kind),
			URL:          asset.URL,
			PosterURL:    firstNonEmptyMetadataString(asset.Metadata, "poster_url", "posterUrl"),
			Base64:       asset.Base64,
			MIMEType:     asset.MIMEType,
			DownloadPath: firstNonEmptyMetadataString(asset.Metadata, "download_path", "downloadPath"),
		})
	}

	status := ValueOrFallback(response.Status, "completed")
	errorMessage := ""
	message := "生成请求已完成。"
	emptyCompletedImage := false
	if coregeneration.Kind(kind) == coregeneration.KindText {
		message = "文本生成已完成。"
		if strings.TrimSpace(response.Text) == "" &&
			(response.Status == "" || response.Status == "completed") {
			message = "文本生成已完成，但未返回文本。"
		}
	}
	if coregeneration.Kind(kind) == coregeneration.KindAudio {
		message = "音频生成已完成。"
		if len(response.Assets) == 0 &&
			(response.Status == "" || response.Status == "completed") {
			message = "音频生成已完成，但未返回音频素材。"
		}
	}
	if coregeneration.Kind(kind) == coregeneration.KindImage &&
		len(response.Assets) == 0 &&
		(response.Status == "" || response.Status == "completed") {
		emptyCompletedImage = true
		status = "failed"
		message = "图像生成失败。"
		errorMessage = "生成请求已完成，但未返回图片素材。"
	}
	if status == "failed" {
		if !emptyCompletedImage {
			message = "生成请求失败。"
		}
		errorMessage = shared.FirstNonEmpty(
			errorMessage,
			StringFromMetadata(response.Metadata, "error"),
			StringFromMetadata(response.Metadata, "error_message"),
			StringFromMetadata(response.Metadata, "task_status_msg"),
		)
		if metadataMessage := StringFromMetadata(response.Metadata, "failure_message"); metadataMessage != "" {
			message = metadataMessage
		}
	}
	if coregeneration.Kind(kind) == coregeneration.KindVideo && status != "completed" && status != "failed" {
		message = "视频生成任务已提交，完成后请再次检查状态。"
	}
	if warnings := StringSliceFromMetadata(response.Metadata, "asset_cache_warnings"); len(warnings) > 0 {
		message += " 本地素材缓存失败：" + strings.Join(warnings, "；")
	}

	return GenerationMessageResponse{
		ID:      ValueOrFallback(response.ID, shared.MustRandomID("generation")),
		Role:    "assistant",
		Status:  status,
		Message: message,
		Text:    response.Text,
		Assets:  assets,
		Usage: GenerationUsage{
			InputTokens:     response.Usage.InputTokens,
			OutputTokens:    response.Usage.OutputTokens,
			TotalTokens:     response.Usage.TotalTokens,
			ReasoningTokens: response.Usage.ReasoningTokens,
			CachedTokens:    response.Usage.CachedTokens,
		},
		Error:     errorMessage,
		ErrorCode: StringFromMetadata(response.Metadata, "error_code"),
		ErrorType: StringFromMetadata(response.Metadata, "error_type"),
		Retryable: BoolFromMetadata(response.Metadata, "retryable"),
	}
}

func generationResponseWithAssetTitle(response GenerationMessageResponse, assetTitle string) GenerationMessageResponse {
	assetTitle = strings.TrimSpace(assetTitle)
	if assetTitle == "" || len(response.Assets) == 0 {
		return response
	}
	for index := range response.Assets {
		if strings.TrimSpace(response.Assets[index].Title) == "" {
			response.Assets[index].Title = assetTitle
		}
	}
	return response
}

func generationAssetTitleFromNotificationTarget(target *GenerationNotificationTarget) string {
	if target == nil {
		return ""
	}
	return strings.TrimSpace(target.Section.HeadingText)
}

func generationAssetTitleFromTask(task GenerationTaskRecord) string {
	if title := stringFromGenerationParam(task.Params, generationAssetTitleRequestOption); title != "" {
		return title
	}
	return generationFirstAssetTitle(task.Assets)
}

func generationFirstAssetTitle(assets []GenerationAsset) string {
	for _, asset := range assets {
		if title := strings.TrimSpace(asset.Title); title != "" {
			return title
		}
	}
	return ""
}

func stringFromGenerationParam(params map[string]any, key string) string {
	if len(params) == 0 {
		return ""
	}
	value, _ := params[key].(string)
	return strings.TrimSpace(value)
}

func generationParamsWithAssetTitle(params map[string]any, assetTitle string) map[string]any {
	assetTitle = strings.TrimSpace(assetTitle)
	if assetTitle == "" {
		return params
	}
	next := make(map[string]any, len(params)+1)
	for key, value := range params {
		next[key] = value
	}
	next[generationAssetTitleRequestOption] = assetTitle
	return next
}

func generationParamsForClient(params map[string]any) map[string]any {
	if len(params) == 0 {
		return params
	}
	next := make(map[string]any, len(params))
	for key, value := range params {
		if strings.HasPrefix(key, generationInternalParamPrefix) {
			continue
		}
		next[key] = value
	}
	return next
}

// FailedGenerationResponse returns a failed generation response.
func FailedGenerationResponse(id string, err error) GenerationMessageResponse {
	failure := GenerationFailureDetailsFromError(err)
	errorMessage := generationSafeFailureError(failure)
	return GenerationMessageResponse{
		ID:        ValueOrFallback(id, shared.MustRandomID("generation")),
		Role:      "assistant",
		Status:    "failed",
		Message:   failure.Message,
		Assets:    []GenerationAsset{},
		Usage:     GenerationUsage{},
		Error:     errorMessage,
		ErrorCode: failure.Code,
		ErrorType: failure.Type,
		Retryable: failure.Retryable,
	}
}

func generationSafeFailureError(failure generationFailureDetails) string {
	if raw := strings.TrimSpace(failure.Raw); raw != "" {
		return raw
	}
	if message := strings.TrimSpace(failure.Message); message != "" {
		return message
	}
	return "生成请求失败。"
}

// SubmittingGenerationResponse returns a local async submission response.
func SubmittingGenerationResponse(id string, kind coregeneration.Kind) GenerationMessageResponse {
	message := "生成请求正在提交到模型服务，可以安全刷新页面。"
	if kind == coregeneration.KindVideo {
		message = "视频生成任务正在提交到模型服务，完成提交后会自动检查状态。"
	}
	return GenerationMessageResponse{
		ID:      ValueOrFallback(id, shared.MustRandomID("generation")),
		Role:    "assistant",
		Status:  "submitting",
		Message: message,
		Assets:  []GenerationAsset{},
		Usage:   GenerationUsage{},
	}
}

// SubmittedGenerationResponse returns an async generation response.
func SubmittedGenerationResponse(id string, kind coregeneration.Kind) GenerationMessageResponse {
	message := "生成请求正在服务器上运行，可以安全刷新页面。"
	if kind == coregeneration.KindVideo {
		message = "视频生成任务已提交，完成后请再次检查状态。"
	}
	return GenerationMessageResponse{
		ID:      ValueOrFallback(id, shared.MustRandomID("generation")),
		Role:    "assistant",
		Status:  "submitted",
		Message: message,
		Assets:  []GenerationAsset{},
		Usage:   GenerationUsage{},
	}
}

// GenerationResponseFromTask maps one stored task to a message response.
func GenerationResponseFromTask(task GenerationTaskRecord) GenerationMessageResponse {
	return GenerationMessageResponse{
		ID:        task.ID,
		Role:      "assistant",
		Status:    task.Status,
		Message:   task.Message,
		Text:      task.Text,
		Assets:    task.Assets,
		Usage:     task.Usage,
		Error:     task.Error,
		ErrorCode: task.ErrorCode,
		ErrorType: task.ErrorType,
		Retryable: task.Retryable,
	}
}

// ResolveGenerationRoute resolves a route from a generation API request.
func ResolveGenerationRoute(request GenerationMessageRequest) (coregeneration.ModelRoute, error) {
	return coregeneration.ResolveRoute(coregeneration.RouteQuery{
		Kind:    coregeneration.Kind(request.Kind),
		RouteID: request.RouteID,
		ModelID: request.ModelID,
	})
}

// GenerationRequestFromMessage maps an API message request to the core provider request.
func GenerationRequestFromMessage(
	payload GenerationMessageRequest,
	route coregeneration.ModelRoute,
	referenceURLs []string,
) coregeneration.Request {
	if route.Kind == coregeneration.KindText {
		return coregeneration.Request{
			Kind:          coregeneration.Kind(payload.Kind),
			RouteID:       payload.RouteID,
			FamilyID:      payload.FamilyID,
			VersionID:     payload.VersionID,
			Provider:      payload.Provider,
			ModelID:       payload.ModelID,
			Model:         payload.Model,
			Prompt:        payload.Prompt,
			ReferenceURLs: referenceURLs,
			Params:        providerGenerationParams(payload.Params),
			Options:       generationRequestOptions(payload),
		}
	}
	if route.Kind == coregeneration.KindAudio {
		return coregeneration.Request{
			Kind:          coregeneration.Kind(payload.Kind),
			RouteID:       payload.RouteID,
			FamilyID:      payload.FamilyID,
			VersionID:     payload.VersionID,
			Provider:      payload.Provider,
			ModelID:       payload.ModelID,
			Model:         payload.Model,
			Prompt:        payload.Prompt,
			ReferenceURLs: referenceURLs,
			Params:        providerGenerationParams(payload.Params),
			Options:       generationRequestOptions(payload),
		}
	}

	return coregeneration.Request{
		Kind:           coregeneration.Kind(payload.Kind),
		RouteID:        payload.RouteID,
		FamilyID:       payload.FamilyID,
		VersionID:      payload.VersionID,
		Provider:       payload.Provider,
		ModelID:        payload.ModelID,
		Model:          payload.Model,
		Prompt:         payload.Prompt,
		ReferenceURLs:  referenceURLs,
		OutputFormat:   "png",
		ResponseFormat: ResponseFormatForRoute(route),
		Watermark:      BoolPtr(false),
		Params:         providerGenerationParams(payload.Params),
		Options:        generationRequestOptions(payload),
	}
}

func generationRequestOptions(payload GenerationMessageRequest) map[string]any {
	assetTitle := strings.TrimSpace(payload.AssetTitle)
	if assetTitle == "" {
		return nil
	}
	return map[string]any{
		generationAssetTitleRequestOption: assetTitle,
	}
}

func generationAssetTitleFromRequest(request coregeneration.Request) string {
	if len(request.Options) == 0 {
		return ""
	}
	value, _ := request.Options[generationAssetTitleRequestOption].(string)
	return strings.TrimSpace(value)
}

// ShouldRunGenerationInBackground reports whether the route should be executed asynchronously by the server.
func ShouldRunGenerationInBackground(route coregeneration.ModelRoute) bool {
	return route.Kind == coregeneration.KindImage && !route.Async
}

// ShouldSubmitGenerationInBackground reports whether the provider task should be submitted after the HTTP response.
func ShouldSubmitGenerationInBackground(route coregeneration.ModelRoute) bool {
	return route.Kind == coregeneration.KindVideo && route.Async
}

// RouteForGenerationTaskID resolves the provider route for a stored task ID.
func RouteForGenerationTaskID(id string) (coregeneration.ModelRoute, error) {
	prefix, _, ok := strings.Cut(id, ":")
	if !ok || prefix == "" {
		route, routeOK := coregeneration.DefaultRoute(coregeneration.KindVideo)
		if !routeOK {
			return coregeneration.ModelRoute{}, errors.New("no generation route is available for this task")
		}
		return route, nil
	}

	route, ok := coregeneration.FindRoute(prefix)
	if !ok {
		route, ok = coregeneration.FindRouteByLegacyModelID(prefix)
	}
	if !ok {
		return coregeneration.ModelRoute{}, errors.New("unknown generation task route")
	}
	return route, nil
}

// RouteForStoredGenerationTask resolves the provider route for a persisted task.
func RouteForStoredGenerationTask(id string, task GenerationTaskRecord, found bool) (coregeneration.ModelRoute, error) {
	if !found {
		return RouteForGenerationTaskID(id)
	}

	route, ok := coregeneration.FindRoute(task.RouteID)
	if !ok {
		return coregeneration.ModelRoute{}, errors.New("unknown generation task route")
	}
	return route, nil
}

// RequireGenerationRouteConfigured validates route availability and credentials.
func RequireGenerationRouteConfigured(route coregeneration.ModelRoute, configured bool, credentialLabel string) error {
	if route.Status != coregeneration.RouteStatusAvailable {
		if route.StatusReason != "" {
			return errors.New(route.StatusReason)
		}
		return errors.New("生成供应商不可用")
	}
	if configured {
		return nil
	}
	if route.Provider == coregeneration.ProviderJimeng {
		return errors.New("即梦尚未登录，请先在设置的 API 密钥页完成即梦登录")
	}
	return fmt.Errorf("%s API Key 尚未配置", credentialLabel)
}

// GenerationRouteConfigured reports whether every required route credential is present.
func GenerationRouteConfigured(route coregeneration.ModelRoute, hasAPIKey func(string) bool) bool {
	if route.Status != coregeneration.RouteStatusAvailable {
		return false
	}
	for _, authKey := range route.AuthKeys {
		if hasAPIKey == nil || !hasAPIKey(authKey) {
			return false
		}
	}
	return len(route.AuthKeys) > 0
}

// GenerationRouteCredentialLabel returns the display label for a route credential.
func GenerationRouteCredentialLabel(route coregeneration.ModelRoute, providerLabel func(string) string) string {
	if len(route.AuthKeys) == 0 {
		return route.Provider
	}
	if providerLabel == nil {
		return route.AuthKeys[0]
	}
	return providerLabel(route.AuthKeys[0])
}

// ResponseFormatForRoute returns the response format requested from providers.
func ResponseFormatForRoute(coregeneration.ModelRoute) string {
	return "url"
}

// StringSliceFromMetadata reads a string slice from generation metadata.
func StringSliceFromMetadata(metadata map[string]any, key string) []string {
	if len(metadata) == 0 {
		return []string{}
	}

	switch value := metadata[key].(type) {
	case []string:
		return value
	case []any:
		result := []string{}
		for _, item := range value {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return []string{}
	}
}

// StringFromMetadata reads a string value from generation metadata.
func StringFromMetadata(metadata map[string]any, key string) string {
	if len(metadata) == 0 {
		return ""
	}

	switch value := metadata[key].(type) {
	case string:
		return strings.TrimSpace(value)
	case fmt.Stringer:
		return strings.TrimSpace(value.String())
	default:
		return ""
	}
}

func firstNonEmptyMetadataString(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := StringFromMetadata(metadata, key); value != "" {
			return value
		}
	}
	return ""
}

// BoolFromMetadata reads a boolean value from generation metadata.
func BoolFromMetadata(metadata map[string]any, key string) bool {
	if len(metadata) == 0 {
		return false
	}

	switch value := metadata[key].(type) {
	case bool:
		return value
	case string:
		return strings.EqualFold(strings.TrimSpace(value), "true")
	default:
		return false
	}
}

type generationFailureDetails struct {
	Code      string
	Type      string
	Message   string
	Raw       string
	Retryable bool
}

// GenerationFailureDetailsFromError maps a provider error to API-facing failure fields.
func GenerationFailureDetailsFromError(err error) generationFailureDetails {
	if err == nil {
		return generationFailureDetails{Message: "生成请求失败。"}
	}

	if failure, ok := coregeneration.FailureFromError(err); ok {
		return generationFailureDetails{
			Code:      strings.TrimSpace(failure.Code),
			Type:      string(failure.Reason),
			Message:   generationFailureMessage(failure),
			Raw:       shared.FirstNonEmpty(failure.Raw, err.Error()),
			Retryable: failure.Retryable,
		}
	}
	if isGenerationTimeoutError(err) {
		failure := coregeneration.FailureInfo{Code: "timeout", Reason: coregeneration.FailureTimeout, Retryable: true}
		return generationFailureDetails{
			Code:      failure.Code,
			Type:      string(failure.Reason),
			Message:   generationFailureMessage(failure),
			Raw:       err.Error(),
			Retryable: failure.Retryable,
		}
	}

	return generationFailureDetails{
		Message: "生成请求失败。",
		Raw:     err.Error(),
	}
}

func isGenerationTimeoutError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	normalized := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(normalized, "deadline exceeded") ||
		strings.Contains(normalized, "timeout") ||
		strings.Contains(normalized, "timed out") ||
		strings.Contains(normalized, "超时")
}

func generationFailureMessage(failure coregeneration.FailureInfo) string {
	switch failure.Reason {
	case coregeneration.FailurePolicyViolation:
		return "生成结果触发供应商内容安全策略，未返回可用结果。"
	case coregeneration.FailureInvalidParameter:
		return "请求参数无效，请调整参数后重试。"
	case coregeneration.FailureTimeout:
		return "模型服务响应超时，任务可能仍在处理中，请稍后再检查。"
	case coregeneration.FailureRateLimited:
		return "供应商请求频率受限，请稍后重试。"
	case coregeneration.FailureAuthentication:
		return "供应商密钥未配置或无效，请检查供应商配置。"
	default:
		return "供应商返回错误，请稍后重试或调整请求。"
	}
}

// ShouldPersistGenerationTask reports whether the route should be tracked as a task.
func ShouldPersistGenerationTask(route coregeneration.ModelRoute) bool {
	return route.ID != ""
}

// GenerationTaskFromMessage creates a task record from request and response data.
func GenerationTaskFromMessage(
	request GenerationMessageRequest,
	route coregeneration.ModelRoute,
	response GenerationMessageResponse,
) GenerationTaskRecord {
	documentID := strings.TrimSpace(request.DocumentID)
	if documentID == "" && request.DocumentContext != nil {
		documentID = strings.TrimSpace(request.DocumentContext.DocumentID)
	}
	assetTitle := firstNonEmpty(request.AssetTitle, generationFirstAssetTitle(response.Assets))
	response = generationResponseWithAssetTitle(response, assetTitle)
	responseError := generationTaskErrorFromResponse(response)
	return GenerationTaskRecord{
		ID:                response.ID,
		ProviderTaskID:    generationProviderTaskIDForResponse(route, response),
		ConversationID:    request.ConversationID,
		ProjectID:         GenerationProjectIDForRequest(request.ProjectID, request.ScopeID),
		DocumentID:        documentID,
		SectionID:         strings.TrimSpace(request.SectionID),
		CapabilityID:      GenerationCapabilityIDForRequest(request.CapabilityID, route),
		ResourceType:      GenerationResourceTypeForRequest(request),
		Kind:              string(route.Kind),
		RouteID:           route.ID,
		FamilyID:          route.FamilyID,
		VersionID:         route.VersionID,
		Provider:          route.Provider,
		ModelID:           request.ModelID,
		Model:             request.Model,
		Prompt:            request.Prompt,
		ReferenceURLs:     CompactStrings(request.ReferenceURLs),
		ReferenceAssetIDs: CompactStrings(request.ReferenceAssetIDs),
		Params: generationParamsWithReferenceBindings(
			generationParamsWithAssetTitle(request.Params, assetTitle),
			request.ReferenceBindings,
		),
		Status:    response.Status,
		Message:   response.Message,
		Text:      response.Text,
		Assets:    response.Assets,
		Usage:     response.Usage,
		Error:     responseError,
		ErrorCode: response.ErrorCode,
		ErrorType: response.ErrorType,
		Retryable: response.Retryable,
	}
}

func generationTaskErrorFromResponse(response GenerationMessageResponse) string {
	errorMessage := strings.TrimSpace(response.Error)
	if errorMessage != "" || response.Status != "failed" {
		return errorMessage
	}
	return shared.FirstNonEmpty(strings.TrimSpace(response.Message), "生成请求失败。")
}

// GenerationResourceTypeForRequest resolves the project resource type a request
// targets. Explicit resourceType wins; a capabilityId that names a resource type
// is honored for callers that predate the dedicated field.
func GenerationResourceTypeForRequest(request GenerationMessageRequest) string {
	if resourceType := selectedGenerationResourceType(request.ResourceType); resourceType != "" {
		return resourceType
	}
	return selectedGenerationResourceType(request.CapabilityID)
}

// GenerationCapabilityIDForRequest returns an explicit capability id or the route kind default.
func GenerationCapabilityIDForRequest(capabilityID string, route coregeneration.ModelRoute) string {
	if capabilityID = strings.TrimSpace(capabilityID); capabilityID != "" {
		return capabilityID
	}
	switch route.Kind {
	case coregeneration.KindImage:
		return "image.generate"
	case coregeneration.KindVideo:
		return "video.generate"
	case coregeneration.KindText:
		return "text.generate"
	case coregeneration.KindAudio:
		return "audio.generate"
	default:
		return ""
	}
}

// DefaultGenerationConversationID returns the stable default conversation ID for one scope and kind.
func DefaultGenerationConversationID(scopeID string, kind string) string {
	scopeID = normalizeGenerationConversationIDPart(NormalizeGenerationConversationScopeID(scopeID))
	kind = normalizeGenerationConversationIDPart(kind)
	if kind == "" {
		kind = string(coregeneration.KindImage)
	}
	return "conversation-" + scopeID + "-" + kind + "-default"
}

// NormalizeGenerationConversationScopeID returns the scope used for generation conversations.
func NormalizeGenerationConversationScopeID(scopeID string) string {
	scopeID = strings.TrimSpace(scopeID)
	if scopeID == "" {
		return defaultGenerationConversationScopeID
	}
	return scopeID
}

// GenerationScopeIDForSessionID maps the public session ID to the internal scope ID.
func GenerationScopeIDForSessionID(sessionID string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return defaultGenerationConversationScopeID
	}
	cleaned := domain.CleanProjectID(sessionID)
	if strings.HasPrefix(cleaned, generationProjectScopePrefix) {
		return generationProjectScopePrefix + cleaned
	}
	return sessionID
}

// GenerationSessionIDFromScopeID maps an internal scope ID back to the public session ID.
func GenerationSessionIDFromScopeID(scopeID string) string {
	scopeID = NormalizeGenerationConversationScopeID(scopeID)
	if scopeID == defaultGenerationConversationScopeID || scopeID == agentGenerationConversationScopeID {
		return scopeID
	}
	if strings.HasPrefix(scopeID, generationProjectScopePrefix) {
		return domain.CleanProjectID(strings.TrimPrefix(scopeID, generationProjectScopePrefix))
	}
	return scopeID
}

// GenerationProjectIDFromScopeID returns the project ID encoded in a generation scope.
func GenerationProjectIDFromScopeID(scopeID string) string {
	scopeID = strings.TrimSpace(scopeID)
	if !strings.HasPrefix(scopeID, generationProjectScopePrefix) {
		return ""
	}
	return domain.CleanProjectID(strings.TrimPrefix(scopeID, generationProjectScopePrefix))
}

// GenerationProjectIDForRequest returns the explicit project ID or falls back to the scope encoding.
func GenerationProjectIDForRequest(projectID string, scopeID string) string {
	if cleaned := domain.CleanProjectID(projectID); cleaned != "" {
		return cleaned
	}
	return GenerationProjectIDFromScopeID(scopeID)
}

// IsDefaultGenerationConversationID reports whether id is a default conversation ID.
func IsDefaultGenerationConversationID(id string) bool {
	return strings.HasPrefix(strings.TrimSpace(id), "conversation-") &&
		strings.HasSuffix(strings.TrimSpace(id), "-default")
}

func includeLegacyDefaultGenerationTasks(scopeID string, kind string, conversationID string) bool {
	scopeID = NormalizeGenerationConversationScopeID(scopeID)
	return scopeID == defaultGenerationConversationScopeID &&
		strings.TrimSpace(conversationID) == DefaultGenerationConversationID(scopeID, kind)
}

func normalizeGenerationConversationIDPart(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = generationConversationIDPartPattern.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-_")
	if value == "" {
		return "default"
	}
	return value
}

// GenerationTaskWithMessage applies response fields to a task record.
func GenerationTaskWithMessage(task GenerationTaskRecord, response GenerationMessageResponse) GenerationTaskRecord {
	if strings.TrimSpace(task.ID) == "" {
		task.ID = response.ID
	}
	if task.ProviderTaskID == "" && task.Kind == string(coregeneration.KindVideo) {
		task.ProviderTaskID = generationProviderTaskIDFromMessageID(response.ID, task.ID)
	}
	task.Status = response.Status
	task.Message = response.Message
	task.Text = response.Text
	task.Assets = response.Assets
	task.Usage = response.Usage
	if response.Error != "" {
		task.Error = response.Error
	}
	if response.ErrorCode != "" {
		task.ErrorCode = response.ErrorCode
	}
	if response.ErrorType != "" {
		task.ErrorType = response.ErrorType
	}
	task.Retryable = response.Retryable
	if IsActiveGenerationStatus(response.Status) {
		task.Error = ""
		task.ErrorCode = ""
		task.ErrorType = ""
		task.Retryable = false
	}
	if response.Status == "completed" {
		task.Error = ""
		task.ErrorCode = ""
		task.ErrorType = ""
		task.Retryable = false
	}
	// A failed batch that still produced stored assets is a partial success:
	// keep the results usable downstream (section history, overview counts,
	// selected-asset sync) instead of hiding them behind a failed task. The
	// error fields stay populated so the shortfall remains visible.
	if strings.EqualFold(strings.TrimSpace(task.Status), "failed") {
		if kept := storedGenerationAssetCount(task); kept > 0 {
			task.Status = "completed"
			task.Message = fmt.Sprintf("部分成功：已生成 %d 张，其余失败。%s", kept, strings.TrimSpace(task.Message))
		}
	}

	return task
}

// storedGenerationAssetCount counts non-deleted assets that reference stored
// content (asset id, URL, or inline payload).
func storedGenerationAssetCount(task GenerationTaskRecord) int {
	deleted := generationDeletedAssetSlotSet(task.DeletedAssetSlots)
	count := 0
	for _, asset := range task.Assets {
		if deleted[asset.SlotIndex] {
			continue
		}
		if strings.TrimSpace(asset.AssetID) != "" || strings.TrimSpace(asset.URL) != "" || strings.TrimSpace(asset.Base64) != "" {
			count++
		}
	}
	return count
}

// GenerationTaskProviderPollID returns the provider task id used for video polling.
func GenerationTaskProviderPollID(task GenerationTaskRecord) string {
	if value := strings.TrimSpace(task.ProviderTaskID); value != "" {
		return value
	}
	if strings.Contains(strings.TrimSpace(task.ID), ":") {
		return strings.TrimSpace(task.ID)
	}
	return ""
}

// IsActiveGenerationStatus reports whether a task status is still in progress.
func IsActiveGenerationStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "submitted", "running", "pending", "processing", "queued":
		return true
	case "submitting":
		return true
	default:
		return false
	}
}

func generationProviderTaskIDForResponse(route coregeneration.ModelRoute, response GenerationMessageResponse) string {
	if route.Kind != coregeneration.KindVideo || !route.Async {
		return ""
	}
	return generationProviderTaskIDFromMessageID(response.ID, "")
}

func generationProviderTaskIDFromMessageID(messageID string, localID string) string {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" || messageID == strings.TrimSpace(localID) || !strings.Contains(messageID, ":") {
		return ""
	}
	return messageID
}

// AppendStorageWarning appends a local persistence warning to a message.
func AppendStorageWarning(message string, err error) string {
	if err == nil {
		return message
	}
	if strings.TrimSpace(message) == "" {
		return "本地任务历史保存失败：" + err.Error()
	}

	return message + " 本地任务历史保存失败：" + err.Error()
}

// NormalizeGenerationParams returns a non-nil params map for downstream routing.
func NormalizeGenerationParams(params map[string]any) map[string]any {
	if params == nil {
		return map[string]any{}
	}

	return params
}

func providerGenerationParams(params map[string]any) map[string]any {
	if len(params) == 0 {
		return params
	}

	cleaned := make(map[string]any, len(params))
	for key, value := range params {
		if strings.HasPrefix(key, generationInternalParamPrefix) {
			continue
		}
		cleaned[key] = value
	}
	return cleaned
}

// CompactStrings trims strings and removes empty entries.
func CompactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}

	return result
}

// BoolPtr returns a pointer to a bool.
func BoolPtr(value bool) *bool {
	return &value
}

// ValueOrFallback returns value when non-empty, otherwise fallback.
func ValueOrFallback(value string, fallback string) string {
	if value != "" {
		return value
	}

	return fallback
}
