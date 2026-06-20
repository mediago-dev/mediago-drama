package generation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const generationVoicePreviewPrompt = "你好，这是一段音色试听。"

// PreviewGenerationVoice generates a short audio sample without creating history.
func (workflow *GenerationService) PreviewGenerationVoice(
	ctx context.Context,
	payload GenerationVoicePreviewRequest,
) (GenerationVoicePreviewResponse, int, error) {
	routeID := strings.TrimSpace(payload.RouteID)
	voiceID := strings.TrimSpace(payload.VoiceID)
	if routeID == "" {
		return GenerationVoicePreviewResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 routeId")
	}
	if voiceID == "" {
		return GenerationVoicePreviewResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 voiceId")
	}

	route, ok := coregeneration.FindRoute(routeID)
	if !ok {
		return GenerationVoicePreviewResponse{}, http.StatusBadRequest, fmt.Errorf("unknown generation route %q", routeID)
	}
	if route.Kind != coregeneration.KindAudio {
		return GenerationVoicePreviewResponse{}, http.StatusBadRequest, fmt.Errorf("route %q is %s, not audio", route.ID, route.Kind)
	}

	provider, err := workflow.newGenerationProvider(route)
	if err != nil {
		return GenerationVoicePreviewResponse{}, http.StatusServiceUnavailable, err
	}

	params := defaultGenerationRouteParams(route)
	for key, value := range NormalizeGenerationParams(payload.Params) {
		params[key] = value
	}
	params[string(coregeneration.ParamVoiceID)] = voiceID
	normalizedParams, err := coregeneration.NormalizeRouteParams(route, params)
	if err != nil {
		return GenerationVoicePreviewResponse{}, http.StatusBadRequest, err
	}

	request := GenerationRequestFromMessage(GenerationMessageRequest{
		Kind:      string(coregeneration.KindAudio),
		RouteID:   route.ID,
		FamilyID:  route.FamilyID,
		VersionID: route.VersionID,
		Provider:  route.Provider,
		ModelID:   route.LegacyModelID,
		Model:     route.Model,
		Prompt:    generationVoicePreviewPrompt,
		Params:    normalizedParams,
	}, route, nil)

	runCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()

	response, err := workflow.generateWithProvider(
		runCtx,
		provider,
		request,
		generationProviderLogContext{Action: "voice-preview"},
	)
	if err != nil {
		return GenerationVoicePreviewResponse{}, http.StatusBadGateway, err
	}

	response = workflow.cacheGenerationResponseAssets(ctx, response, "")
	message := GenerationResponseFromCore(response, string(coregeneration.KindAudio))
	if message.Status == "failed" {
		return GenerationVoicePreviewResponse{}, http.StatusBadGateway, errors.New(message.Message)
	}
	if len(message.Assets) == 0 {
		return GenerationVoicePreviewResponse{}, http.StatusBadGateway, fmt.Errorf("音色预览未返回音频")
	}

	asset := message.Assets[0]
	asset.Kind = string(coregeneration.KindAudio)
	asset.Title = "音色试听"
	return GenerationVoicePreviewResponse{Asset: asset}, http.StatusOK, nil
}

func defaultGenerationRouteParams(route coregeneration.ModelRoute) map[string]any {
	params := make(map[string]any, len(route.Params))
	for _, spec := range route.Params {
		if spec.Default != nil {
			params[spec.Name] = spec.Default
		}
	}
	return params
}
