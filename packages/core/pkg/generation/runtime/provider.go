// Package runtime provides a unified generation provider over catalog routes.
package runtime

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/dmx"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/jimeng"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/official"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/openrouter"
)

// CredentialResolver loads credentials by catalog credential key.
type CredentialResolver interface {
	Credential(ctx context.Context, key string) (string, error)
}

// CredentialResolverFunc adapts a function into a CredentialResolver.
type CredentialResolverFunc func(ctx context.Context, key string) (string, error)

// Credential resolves a credential by key.
func (fn CredentialResolverFunc) Credential(ctx context.Context, key string) (string, error) {
	if fn == nil {
		return "", generation.ErrMissingAPIKey
	}

	return fn(ctx, key)
}

// Config controls the unified generation runtime.
type Config struct {
	Credentials CredentialResolver
	HTTPClient  *http.Client

	MultimodalTextProviderFactory MultimodalTextProviderFactory

	DMXBaseURL        string
	OpenRouterBaseURL string
	OpenRouterAppURL  string
	OpenRouterAppName string

	OpenAIBaseURL     string
	GoogleBaseURL     string
	MiniMaxBaseURL    string
	VolcengineBaseURL string
	JimengBinPath     string
	JimengBinDir      string
}

// Provider routes generation requests to the route's configured provider.
type Provider struct {
	config        Config
	cacheMu       sync.Mutex
	providerCache map[string]generation.Provider
}

// NewProvider creates a unified route-aware generation provider.
func NewProvider(config Config) (*Provider, error) {
	if config.Credentials == nil {
		return nil, errors.New("generation credential resolver is required")
	}

	return &Provider{
		config:        config,
		providerCache: map[string]generation.Provider{},
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return "generation-runtime"
}

// Generate dispatches a generation request by route.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	route, err := generation.ResolveRequestRoute(request)
	if err != nil {
		return generation.Response{}, err
	}
	if err := generation.ValidateRequestForRoute(request, route); err != nil {
		return generation.Response{}, err
	}

	routeProvider, err := provider.providerForRoute(ctx, route)
	if err != nil {
		return generation.Response{}, err
	}

	return routeProvider.Generate(ctx, generation.ApplyRoute(request, route))
}

// GenerateTextStream dispatches a streaming text generation request by route.
func (provider *Provider) GenerateTextStream(ctx context.Context, request generation.Request) (generation.TextStream, error) {
	route, err := generation.ResolveRequestRoute(request)
	if err != nil {
		return nil, err
	}
	if err := generation.ValidateRequestForRoute(request, route); err != nil {
		return nil, err
	}

	routeProvider, err := provider.providerForRoute(ctx, route)
	if err != nil {
		return nil, err
	}
	streamProvider, ok := routeProvider.(generation.TextStreamProvider)
	if !ok {
		return nil, fmt.Errorf(
			"generation provider %q does not support text streaming: %w",
			routeProvider.Name(),
			generation.ErrTextStreamingUnsupported,
		)
	}

	return streamProvider.GenerateTextStream(ctx, generation.ApplyRoute(request, route))
}

// Get fetches async task status using the task id route prefix.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	if strings.TrimSpace(id) == "" {
		return generation.Response{}, fmt.Errorf("generation id is required")
	}

	prefix, _ := splitTaskID(id)
	if prefix == "" {
		routeProvider, err := provider.dmxProvider(ctx)
		if err != nil {
			return generation.Response{}, err
		}

		return routeProvider.Get(ctx, id)
	}

	route, ok := generation.FindRouteByTaskPrefix(prefix)
	if !ok {
		return generation.Response{}, fmt.Errorf("unknown generation task route %q", prefix)
	}

	routeProvider, err := provider.providerForRoute(ctx, route)
	if err != nil {
		return generation.Response{}, err
	}

	return routeProvider.Get(ctx, id)
}

func (provider *Provider) providerForRoute(ctx context.Context, route generation.ModelRoute) (generation.Provider, error) {
	if err := generation.ValidateRouteAvailable(route); err != nil {
		return nil, err
	}
	if route.Kind == generation.KindText && provider.config.MultimodalTextProviderFactory != nil {
		credentials, err := provider.routeCredentials(ctx, route)
		if err != nil {
			return nil, err
		}
		multimodalProvider, err := provider.config.MultimodalTextProviderFactory(ctx, route, credentials)
		if err != nil {
			return nil, err
		}
		if multimodalProvider != nil {
			return NewMultimodalTextProvider(multimodalProvider)
		}
	}

	switch generation.ProviderTypeOf(route.Provider) {
	case generation.ProviderTypeOfficial:
		return provider.officialProvider(ctx, route)
	case generation.ProviderTypeAggregator:
		switch route.Provider {
		case generation.ProviderDMX:
			return provider.dmxProvider(ctx)
		case generation.ProviderOpenRouter:
			return provider.openRouterProvider(ctx)
		default:
			return nil, fmt.Errorf("generation provider %q is not implemented", route.Provider)
		}
	case generation.ProviderTypeLocal:
		switch route.Provider {
		case generation.ProviderJimeng:
			return provider.jimengProvider()
		default:
			return nil, fmt.Errorf("generation provider %q is not implemented", route.Provider)
		}
	case "":
		return nil, fmt.Errorf("generation provider %q is not registered", route.Provider)
	default:
		return nil, fmt.Errorf("generation provider %q has unsupported type %q", route.Provider, generation.ProviderTypeOf(route.Provider))
	}
}

func (provider *Provider) jimengProvider() (generation.Provider, error) {
	cacheKey := provider.cacheKey(
		generation.ProviderJimeng,
		provider.config.JimengBinPath,
		provider.config.JimengBinDir,
	)
	return provider.cachedProvider(cacheKey, func() (generation.Provider, error) {
		return jimeng.NewProvider(jimeng.Config{
			BinPath: provider.config.JimengBinPath,
			BinDir:  provider.config.JimengBinDir,
		})
	})
}

func (provider *Provider) dmxProvider(ctx context.Context) (generation.Provider, error) {
	apiKey, err := provider.credential(ctx, generation.ProviderDMX)
	if err != nil {
		return nil, err
	}

	cacheKey := provider.cacheKey(
		generation.ProviderDMX,
		generation.ProviderDMX,
		apiKey,
		provider.config.DMXBaseURL,
	)
	return provider.cachedProvider(cacheKey, func() (generation.Provider, error) {
		return dmx.NewProvider(dmx.Config{
			BaseURL:    provider.config.DMXBaseURL,
			APIKey:     apiKey,
			HTTPClient: provider.config.HTTPClient,
		})
	})
}

func (provider *Provider) openRouterProvider(ctx context.Context) (generation.Provider, error) {
	apiKey, err := provider.credential(ctx, generation.ProviderOpenRouter)
	if err != nil {
		return nil, err
	}

	cacheKey := provider.cacheKey(
		generation.ProviderOpenRouter,
		generation.ProviderOpenRouter,
		apiKey,
		provider.config.OpenRouterBaseURL,
		provider.config.OpenRouterAppURL,
		provider.config.OpenRouterAppName,
	)
	return provider.cachedProvider(cacheKey, func() (generation.Provider, error) {
		return openrouter.NewProvider(openrouter.Config{
			BaseURL:    provider.config.OpenRouterBaseURL,
			APIKey:     apiKey,
			AppURL:     provider.config.OpenRouterAppURL,
			AppTitle:   provider.config.OpenRouterAppName,
			HTTPClient: provider.config.HTTPClient,
		})
	})
}

func (provider *Provider) officialProvider(ctx context.Context, route generation.ModelRoute) (generation.Provider, error) {
	if len(route.AuthKeys) == 0 {
		return nil, generation.ErrMissingAPIKey
	}
	authKey := route.AuthKeys[0]
	apiKey, err := provider.credential(ctx, authKey)
	if err != nil {
		return nil, err
	}

	cacheKey := provider.cacheKey(
		string(generation.ProviderTypeOfficial),
		authKey,
		apiKey,
		provider.config.OpenAIBaseURL,
		provider.config.GoogleBaseURL,
		provider.config.MiniMaxBaseURL,
		provider.config.VolcengineBaseURL,
	)
	return provider.cachedProvider(cacheKey, func() (generation.Provider, error) {
		return official.NewProvider(official.Config{
			APIKey:            apiKey,
			OpenAIBaseURL:     provider.config.OpenAIBaseURL,
			GoogleBaseURL:     provider.config.GoogleBaseURL,
			MiniMaxBaseURL:    provider.config.MiniMaxBaseURL,
			VolcengineBaseURL: provider.config.VolcengineBaseURL,
			HTTPClient:        provider.config.HTTPClient,
		})
	})
}

func (provider *Provider) cachedProvider(cacheKey string, build func() (generation.Provider, error)) (generation.Provider, error) {
	provider.cacheMu.Lock()
	cached := provider.providerCache[cacheKey]
	provider.cacheMu.Unlock()
	if cached != nil {
		return cached, nil
	}

	built, err := build()
	if err != nil {
		return nil, err
	}

	provider.cacheMu.Lock()
	defer provider.cacheMu.Unlock()
	if cached := provider.providerCache[cacheKey]; cached != nil {
		return cached, nil
	}
	if provider.providerCache == nil {
		provider.providerCache = map[string]generation.Provider{}
	}
	provider.providerCache[cacheKey] = built

	return built, nil
}

func (provider *Provider) cacheKey(parts ...string) string {
	return strings.Join(parts, "\x00")
}

func (provider *Provider) credential(ctx context.Context, key string) (string, error) {
	value, err := provider.config.Credentials.Credential(ctx, key)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(value) == "" {
		return "", generation.ErrMissingAPIKey
	}

	return value, nil
}

func (provider *Provider) routeCredentials(ctx context.Context, route generation.ModelRoute) (RouteCredentials, error) {
	if len(route.AuthKeys) == 0 {
		return nil, generation.ErrMissingAPIKey
	}

	credentials := make(RouteCredentials, len(route.AuthKeys))
	for _, key := range route.AuthKeys {
		value, err := provider.credential(ctx, key)
		if err != nil {
			return nil, err
		}
		credentials[key] = value
	}

	return credentials, nil
}

func splitTaskID(id string) (string, string) {
	prefix, taskID, ok := strings.Cut(id, ":")
	if !ok {
		return "", id
	}

	return prefix, taskID
}
