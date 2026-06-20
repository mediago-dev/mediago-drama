package generation

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

// PreviewGenerationVoice returns a bundled local preview sample without creating history.
func (workflow *GenerationService) PreviewGenerationVoice(
	_ context.Context,
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

	preview, ok, err := workflow.localVoicePreviewAsset(route.ID, voiceID)
	if err != nil {
		return GenerationVoicePreviewResponse{}, http.StatusInternalServerError, err
	}
	if !ok {
		return GenerationVoicePreviewResponse{}, http.StatusNotFound, fmt.Errorf("音色暂无本地试听")
	}

	return GenerationVoicePreviewResponse{
		Asset: GenerationAsset{
			Kind:     string(coregeneration.KindAudio),
			Title:    "音色试听",
			URL:      preview.URL,
			MIMEType: preview.MIMEType,
		},
	}, http.StatusOK, nil
}

func (workflow *GenerationService) listVoicePreviewAssets() []GenerationVoicePreviewAsset {
	previews, err := workflow.voicePreviews.List()
	if err != nil {
		return nil
	}
	return previews
}

func (workflow *GenerationService) localVoicePreviewAsset(routeID string, voiceID string) (GenerationVoicePreviewAsset, bool, error) {
	return workflow.voicePreviews.Asset(routeID, voiceID)
}

// GenerationVoicePreviewContent returns bundled preview audio content for HTTP serving.
func (workflow *GenerationService) GenerationVoicePreviewContent(routeID string, voiceID string) (GenerationVoicePreviewAsset, []byte, bool, error) {
	return workflow.voicePreviews.Content(routeID, voiceID)
}
