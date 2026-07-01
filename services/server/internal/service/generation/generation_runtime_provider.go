package generation

import (
	"context"
	"errors"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/runtime"
)

func (workflow *GenerationService) newGenerationProvider(route coregeneration.ModelRoute) (coregeneration.Provider, error) {
	if route.Status != coregeneration.RouteStatusAvailable {
		return nil, errors.New(route.StatusReason)
	}
	if err := workflow.requireGenerationRouteConfigured(route); err != nil {
		return nil, err
	}
	if workflow.generationProviderFactory != nil {
		return workflow.generationProviderFactory(route)
	}

	return runtime.NewProvider(runtime.Config{
		Credentials:                   workflow.generationCredentialResolver(),
		MultimodalTextProviderFactory: workflow.multimodalTextProviderFactory,
		OpenRouterAppName:             "mediago-drama",
		MediagoBaseURL:                workflow.mediagoBaseURL,
		JimengBinPath:                 workflow.jimengBinPath,
		JimengBinDir:                  workflow.jimengBinDir,
	})
}

func (workflow *GenerationService) newGenerationProviderForTask(id string) (coregeneration.Provider, error) {
	route, err := RouteForGenerationTaskID(id)
	if err != nil {
		return nil, err
	}
	return workflow.newGenerationProvider(route)
}

func (workflow *GenerationService) generationCredentialResolver() runtime.CredentialResolver {
	return runtime.CredentialResolverFunc(func(_ context.Context, key string) (string, error) {
		value, _, err := workflow.settings.GetAPIKey(context.Background(), key)
		return value, err
	})
}

func (workflow *GenerationService) newGenerationProviderForStoredTask(
	id string,
	task generationTaskRecord,
	found bool,
) (coregeneration.Provider, error) {
	route, err := RouteForStoredGenerationTask(id, task, found)
	if err != nil {
		return nil, err
	}
	return workflow.newGenerationProvider(route)
}

func (workflow *GenerationService) requireGenerationRouteConfigured(route coregeneration.ModelRoute) error {
	return RequireGenerationRouteConfigured(
		route,
		workflow.generationRouteConfigured(route),
		workflow.generationRouteCredentialLabel(route),
	)
}

func (workflow *GenerationService) generationRouteConfigured(route coregeneration.ModelRoute) bool {
	if workflow == nil || workflow.settings == nil {
		return false
	}
	if route.Provider == coregeneration.ProviderMediago && strings.TrimSpace(workflow.mediagoBaseURL) == "" {
		return false
	}
	return GenerationRouteConfigured(route, func(authKey string) bool {
		value, _, err := workflow.settings.GetAPIKey(context.Background(), authKey)
		if err != nil {
			return false
		}
		return strings.TrimSpace(value) != ""
	})
}

// RouteConfigured reports whether routeID resolves and all credentials are present.
func (workflow *GenerationService) RouteConfigured(routeID string) bool {
	route, ok := coregeneration.FindRoute(routeID)
	if !ok {
		return false
	}
	return workflow.generationRouteConfigured(route)
}

func (workflow *GenerationService) generationRouteCredentialLabel(route coregeneration.ModelRoute) string {
	if workflow == nil || workflow.settings == nil {
		return GenerationRouteCredentialLabel(route, nil)
	}
	return GenerationRouteCredentialLabel(route, workflow.settings.ProviderLabel)
}
