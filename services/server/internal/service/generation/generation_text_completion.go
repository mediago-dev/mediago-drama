package generation

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/textcompletion"
)

// TextCompletionRequest requests a non-persisted text model completion.
type TextCompletionRequest struct {
	Prompt            string
	SystemInstruction string
	Executor          textcompletion.ExecutorType
	RouteID           string
	Model             string
	Params            map[string]any
}

// CompleteText runs one text completion without creating a persisted generation task.
func (workflow *GenerationService) CompleteText(ctx context.Context, request TextCompletionRequest) (string, error) {
	if workflow == nil {
		return "", fmt.Errorf("generation service is nil")
	}
	if workflow.textCompletion != nil {
		result, err := workflow.textCompletion.Complete(ctx, textcompletion.Request{
			Prompt:            request.Prompt,
			SystemInstruction: request.SystemInstruction,
			Executor:          request.Executor,
			RouteID:           request.RouteID,
			Model:             request.Model,
			Params:            request.Params,
		})
		if err != nil {
			return "", err
		}
		return result.Text, nil
	}
	return workflow.completeTextWithRoute(ctx, request)
}

// SetCodexTextBackend enables route-first text completion with Codex fallback.
func (workflow *GenerationService) SetCodexTextBackend(
	backend textcompletion.Backend,
	available textcompletion.AvailabilityFunc,
) {
	if workflow == nil {
		return
	}
	routeBackend := textcompletion.BackendFunc(func(ctx context.Context, request textcompletion.Request) (textcompletion.Result, error) {
		text, err := workflow.completeTextWithRoute(ctx, TextCompletionRequest{
			Prompt:            request.Prompt,
			SystemInstruction: request.SystemInstruction,
			RouteID:           request.RouteID,
			Model:             request.Model,
			Params:            request.Params,
		})
		if err != nil {
			return textcompletion.Result{}, err
		}
		return textcompletion.Result{Text: text, Executor: textcompletion.ExecutorRoute, Model: request.Model}, nil
	})
	routeAvailable := func(_ context.Context, request textcompletion.Request) bool {
		_, err := workflow.resolveConfiguredTextRoute(request.RouteID)
		return err == nil
	}
	workflow.SetTextCompletionService(textcompletion.NewService(routeBackend, backend, routeAvailable, available))
}

func (workflow *GenerationService) completeTextWithRoute(ctx context.Context, request TextCompletionRequest) (string, error) {
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}
	route, err := workflow.resolveConfiguredTextRoute(request.RouteID)
	if err != nil {
		return "", err
	}
	provider, err := workflow.newGenerationProvider(route)
	if err != nil {
		return "", err
	}

	model := strings.TrimSpace(request.Model)
	if model == "" {
		model = route.Model
	}
	runCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()
	generationRequest := coregeneration.Request{
		Kind:      coregeneration.KindText,
		RouteID:   route.ID,
		FamilyID:  route.FamilyID,
		VersionID: route.VersionID,
		Provider:  route.Provider,
		ModelID:   route.LegacyModelID,
		Model:     model,
		Prompt:    prompt,
		Params:    request.Params,
	}
	streamProvider, ok := provider.(coregeneration.TextStreamProvider)
	if ok {
		stream, err := streamProvider.GenerateTextStream(runCtx, generationRequest)
		if err != nil && !errors.Is(err, coregeneration.ErrTextStreamingUnsupported) {
			return "", err
		}
		if err == nil {
			defer stream.Close()

			var builder strings.Builder
			for {
				event, err := stream.Recv()
				if err == io.EOF {
					break
				}
				if err != nil {
					return "", err
				}
				builder.WriteString(event.Delta)
				if event.Done {
					break
				}
			}
			return builder.String(), nil
		}
	}

	response, err := provider.Generate(runCtx, generationRequest)
	if err != nil {
		return "", err
	}
	return response.Text, nil
}

func (workflow *GenerationService) resolveConfiguredTextRoute(routeID string) (coregeneration.ModelRoute, error) {
	routeID = strings.TrimSpace(routeID)
	if routeID != "" {
		route, ok := coregeneration.FindRoute(routeID)
		if !ok {
			return coregeneration.ModelRoute{}, fmt.Errorf("unknown generation route %q", routeID)
		}
		if route.Kind != coregeneration.KindText {
			return coregeneration.ModelRoute{}, fmt.Errorf("generation route %q is not a text route", route.ID)
		}
		return route, workflow.requireGenerationRouteConfigured(route)
	}

	preferredRouteIDs := []string{
		coregeneration.RouteOfficialGPT55Text,
		coregeneration.RouteOfficialGPT54Text,
		coregeneration.RouteOfficialGPT54MiniText,
		coregeneration.RouteOfficialGPT5MiniText,
		coregeneration.RouteOfficialGPT41MiniText,
		coregeneration.RouteOfficialGemini35FlashText,
		coregeneration.RouteOfficialGemini31ProText,
		coregeneration.RouteOfficialGemini31FlashLiteText,
		coregeneration.RouteOfficialMiniMaxM3Text,
		coregeneration.RouteOfficialMiniMaxM27Text,
		coregeneration.RouteOfficialMiniMaxM27HighspeedText,
		coregeneration.RouteOfficialDeepSeekV4FlashText,
		coregeneration.RouteOfficialDeepSeekV4ProText,
		coregeneration.RouteOpenRouterGPT55Text,
		coregeneration.RouteOpenRouterGPT54Text,
		coregeneration.RouteOpenRouterGPT54MiniText,
		coregeneration.RouteOpenRouterGPT5MiniText,
		coregeneration.RouteOpenRouterGPT41MiniText,
		coregeneration.RouteOpenRouterGemini35FlashText,
		coregeneration.RouteOpenRouterGemini31ProText,
		coregeneration.RouteOpenRouterGemini31FlashLiteText,
		coregeneration.RouteOpenRouterMiniMaxM3Text,
		coregeneration.RouteOpenRouterMiniMaxM27Text,
		coregeneration.RouteOpenRouterMiniMaxM27HighspeedText,
		coregeneration.RouteOpenRouterDeepSeekV4FlashText,
		coregeneration.RouteOpenRouterDeepSeekV4ProText,
		coregeneration.RouteDMXGPT55Text,
		coregeneration.RouteDMXGPT54Text,
		coregeneration.RouteDMXGPT54MiniText,
		coregeneration.RouteDMXGemini35FlashText,
		coregeneration.RouteDMXGemini31ProText,
		coregeneration.RouteDMXGemini31FlashLiteText,
		coregeneration.RouteDMXMiniMaxM3Text,
		coregeneration.RouteDMXMiniMaxM27Text,
		coregeneration.RouteDMXMiniMaxM27HighspeedText,
		coregeneration.RouteDMXDeepSeekV4FlashText,
		coregeneration.RouteDMXDeepSeekV4ProText,
		coregeneration.RouteDMXGPT41MiniText,
	}
	for _, candidateID := range preferredRouteIDs {
		route, ok := coregeneration.FindRoute(candidateID)
		if ok && route.Kind == coregeneration.KindText && workflow.generationRouteConfigured(route) {
			return route, nil
		}
	}
	for _, route := range coregeneration.Routes() {
		if route.Kind == coregeneration.KindText && workflow.generationRouteConfigured(route) {
			return route, nil
		}
	}
	route, ok := coregeneration.DefaultRoute(coregeneration.KindText)
	if !ok {
		return coregeneration.ModelRoute{}, fmt.Errorf("no text generation route is available")
	}
	return route, workflow.requireGenerationRouteConfigured(route)
}

// TextRouteForAgentRuntimeModel maps an ACP runtime model value like
// "mediago/deepseek-v4-flash" back to a generation text route.
func TextRouteForAgentRuntimeModel(value string) (string, string, bool) {
	provider, model, ok := strings.Cut(strings.TrimSpace(value), "/")
	if !ok {
		return "", "", false
	}
	provider, ok = generationProviderForAgentRuntimeProvider(provider)
	if !ok {
		return "", "", false
	}
	model = strings.TrimSpace(model)
	if model == "" {
		return "", "", false
	}
	for _, route := range coregeneration.Routes() {
		if route.Kind == coregeneration.KindText &&
			route.Provider == provider &&
			strings.EqualFold(strings.TrimSpace(route.Model), model) {
			return route.ID, route.Model, true
		}
	}
	return "", "", false
}

func generationProviderForAgentRuntimeProvider(provider string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case coregeneration.ProviderMediago:
		return coregeneration.ProviderMediago, true
	case "dmxapi", coregeneration.ProviderDMX:
		return coregeneration.ProviderDMX, true
	case coregeneration.ProviderOpenRouter:
		return coregeneration.ProviderOpenRouter, true
	case coregeneration.ProviderOpenAI:
		return coregeneration.ProviderOpenAI, true
	case "minimax-cn", coregeneration.ProviderMiniMax:
		return coregeneration.ProviderMiniMax, true
	case coregeneration.ProviderDeepSeek:
		return coregeneration.ProviderDeepSeek, true
	case coregeneration.ProviderGoogle:
		return coregeneration.ProviderGoogle, true
	default:
		return "", false
	}
}
