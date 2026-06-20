package app

import (
	"context"
	"net"
	"strconv"
	"strings"

	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	appagent "github.com/mediago-dev/mediago-drama/services/server/internal/app/agent"
	appevents "github.com/mediago-dev/mediago-drama/services/server/internal/app/events"
	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceacp "github.com/mediago-dev/mediago-drama/services/server/internal/service/acp"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicebilling "github.com/mediago-dev/mediago-drama/services/server/internal/service/billing"
	servicecapability "github.com/mediago-dev/mediago-drama/services/server/internal/service/capability"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	serviceprojectasset "github.com/mediago-dev/mediago-drama/services/server/internal/service/projectasset"
	servicepromptlibrary "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
	servicesettings "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
	serviceworkspaceevent "github.com/mediago-dev/mediago-drama/services/server/internal/service/workspaceevent"
)

func newAPIHandler(config Config) *apiHandler {
	archiveLegacyDocumentTemplates()
	shutdownCtx, shutdownCancel := context.WithCancel(context.Background())
	skillRegistry := serviceskill.NewRegistry()
	workspaceState := appworkspace.NewStateService(config.WorkspaceDir)
	config.WorkspaceDir = workspaceState.Dir()
	settingsDBPath := config.SettingsDBPath
	if settingsDBPath == "" {
		settingsDBPath = workspaceState.DatabasePath()
	}
	mediaDir := config.MediaDir
	if mediaDir == "" {
		mediaDir = workspaceState.LibraryAssetsDir()
	}

	backendService := serviceagent.NewAgentBackendServiceWithBinDir(config.ACPCommand, config.AgentBinDir, config.AgentID)
	buildPrompt := func(request agentRunRequest) string {
		return buildACPPromptWithMaxSectionChars(request, config.PromptMaxSectionChars)
	}
	runner := config.agentRunner
	if runner == nil {
		runner = appagent.NewACPRunnerWithDocumentMCPConfigPathAndArgv(
			config.ACPCommand,
			config.WorkspaceDir,
			config.DocumentMCPConfigPath,
			buildPrompt,
			backendService.ActiveCommand,
			backendService.ActiveArgv,
		)
	}
	documentRunner := config.documentOperationRunner
	if documentRunner == nil {
		documentRunner = mockDocumentOperationRunner{}
	}
	agentRunTimeout := config.AgentRunTimeout
	if agentRunTimeout <= 0 {
		agentRunTimeout = defaultAgentRunTimeout
	}
	agentBridgeToken := strings.TrimSpace(config.AgentBridgeToken)
	if agentBridgeToken == "" {
		agentBridgeToken = mustRandomID("bridge")
	}

	settingsRepos, settingsReposErr := repository.OpenSettingsRepositories(settingsDBPath)
	workspaceRepos, workspaceReposErr := repository.OpenWorkspaceRepositories(workspaceState.DatabasePath())
	settings := servicesettings.NewSettingsWithAgentModelProfiles(settingsRepos.APIKeys, settingsRepos.AgentModelProfiles)
	settings.SetJimengCLIPaths(config.JimengBinPath, config.JimengBinDir)
	if configurableRunner, ok := runner.(interface {
		SetProcessConfigProvider(serviceacp.ProcessConfigProvider)
	}); ok {
		configurableRunner.SetProcessConfigProvider(serviceacp.ProcessConfigProviderFunc(func(ctx context.Context, request serviceacp.ProcessConfigRequest) (serviceacp.ProcessConfig, error) {
			config, err := settings.PrepareOpenCodeRuntimeConfig(ctx, request.WorkspaceDir)
			if err != nil {
				return serviceacp.ProcessConfig{}, err
			}
			return serviceacp.ProcessConfig{
				ConfigDir:        config.ConfigDir,
				Env:              config.Env,
				ProfileCount:     config.ProfileCount,
				DefaultProfileID: config.DefaultProfileID,
			}, nil
		}))
	}
	generationPreferences := servicegeneration.NewGenerationPreferenceServiceFromRepository(settingsRepos.GenerationPreferences, settingsReposErr)
	generationNotifications := servicegeneration.NewGenerationNotificationServiceFromRepository(settingsRepos.GenerationNotifications, settingsReposErr, randomID)
	generationTasks := servicegeneration.NewGenerationTaskServiceFromRepository(settingsRepos.GenerationTasks, settingsReposErr, randomID)
	mediaAssets := servicemedia.NewMediaAssetsFromRepository(settingsRepos.MediaAssets, mediaDir, workspaceState.Dir(), workspaceRepos.Workspace, settingsReposErr)
	mediaAssets.SetMediaToolPaths(config.FFmpegPath, config.FFmpegBinDir)
	previewStreamer := servicemedia.NewFFmpegPreviewStreamer(config.FFmpegPath, config.FFmpegBinDir)
	generationService := servicegeneration.NewGenerationService(settings, generationTasks, mediaAssets, generationPreferences)
	generationService.SetJimengCLIPaths(config.JimengBinPath, config.JimengBinDir)
	generationService.SetGenerationNotifications(generationNotifications)
	promptLibrary := servicepromptlibrary.NewServiceFromRepository(settingsRepos.PromptLibrary, settingsReposErr)
	capabilityRegistry := corecapability.Default()
	capabilityService := servicecapability.NewService(capabilityRegistry, generationService.RouteConfigured)
	billingPrices := config.BillingPrices
	if billingPrices == nil {
		billingPrices = corepricing.Default()
	}
	billingService := servicebilling.NewService(settingsRepos.Billing, billingPrices, capabilityRegistry)
	projectAssets := serviceprojectasset.NewProjectAssetsFromRepository(workspaceRepos.ProjectAssets, mediaDir, workspaceState.Dir(), workspaceRepos.Workspace, workspaceReposErr)
	events := appevents.NewBroker(workspaceState.AppendAgentEvent)
	workspaceEvents := serviceworkspaceevent.NewBroker()
	agentSessions := appagent.NewSessionService(workspaceState)
	agentBridgeURL := strings.TrimSpace(config.AgentBridgeURL)
	if agentBridgeURL == "" {
		agentBridgeURL = defaultAgentBridgeURL(config.Host, config.Port)
	}

	handler := &apiHandler{
		workspaceState:   workspaceState,
		events:           events,
		workspaceEvents:  workspaceEvents,
		agentSessions:    agentSessions,
		agentRunner:      runner,
		documentRunner:   documentRunner,
		agentRunTimeout:  agentRunTimeout,
		agentBridgeURL:   agentBridgeURL,
		agentBridgeToken: agentBridgeToken,
		settings:         settings,
		capability:       capabilityService,
		billing:          billingService,
		backendService:   backendService,
		generation:       generationService,
		mediaAssets:      mediaAssets,
		previewStreamer:  previewStreamer,
		projectAssets:    projectAssets,
		promptLibrary:    promptLibrary,
		skillRegistry:    skillRegistry,
		shutdownCtx:      shutdownCtx,
		shutdownCancel:   shutdownCancel,
	}
	handler.agentRuntime = serviceagent.NewAgentRuntime(
		workspaceState.StateService().Documents,
		agentSessions,
		runner,
		events.Publish,
		serviceagent.AgentRuntimeConfig{
			WorkspaceDir:          workspaceState.Dir(),
			RunTimeout:            agentRunTimeout,
			BridgeURL:             agentBridgeURL,
			BridgeToken:           agentBridgeToken,
			DocumentMCPConfigPath: config.DocumentMCPConfigPath,
			SessionTitleGenerator: func(ctx context.Context, prompt string) (string, error) {
				return generationService.CompleteText(ctx, servicegeneration.TextCompletionRequest{
					Prompt: prompt,
					Params: map[string]any{
						"temperature": 0,
						"maxTokens":   32,
					},
				})
			},
		},
	)
	return handler
}

func defaultAgentBridgeURL(host string, port int) string {
	host = strings.TrimSpace(host)
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		port = 8080
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(port))
}
