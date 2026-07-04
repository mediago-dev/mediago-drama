package generation

import (
	"context"
	"errors"
	"fmt"
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
		LibTVBinPath:                  workflow.libTVBinPath,
		LibTVBinDir:                   workflow.libTVBinDir,
		LibTVProjectID:                workflow.libTVProjectID,
		PippitBinPath:                 workflow.pippitBinPath,
		PippitBinDir:                  workflow.pippitBinDir,
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
	if route.Provider == coregeneration.ProviderMediago &&
		strings.TrimSpace(workflow.mediagoBaseURL) != "" &&
		workflow.generationRouteCredentialsConfigured(route) &&
		!workflow.mediagoRouteModelAvailable(context.Background(), route) {
		return fmt.Errorf("MediaGo 聚合平台当前未启用模型 %s", route.Model)
	}
	return RequireGenerationRouteConfigured(
		route,
		workflow.generationRouteConfigured(route),
		workflow.generationRouteCredentialLabel(route),
	)
}

func (workflow *GenerationService) generationRouteConfigured(route coregeneration.ModelRoute) bool {
	return workflow.generationRouteConfiguredWithMediagoModels(route, nil, false)
}

func (workflow *GenerationService) generationRouteConfiguredWithMediagoModels(
	route coregeneration.ModelRoute,
	mediagoModels map[string]struct{},
	hasMediagoModels bool,
) bool {
	if workflow == nil || workflow.settings == nil {
		return false
	}
	if route.Status != coregeneration.RouteStatusAvailable {
		return false
	}
	if route.Provider == coregeneration.ProviderMediago && strings.TrimSpace(workflow.mediagoBaseURL) == "" {
		return false
	}
	configured := workflow.generationRouteCredentialsConfigured(route)
	if !configured {
		return false
	}
	if route.Provider == coregeneration.ProviderMediago {
		if hasMediagoModels {
			return mediagoModelSetHasRoute(mediagoModels, route)
		}
		return workflow.mediagoRouteModelAvailable(context.Background(), route)
	}
	return true
}

func (workflow *GenerationService) generationRouteCredentialsConfigured(route coregeneration.ModelRoute) bool {
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
