package app

import (
	"context"
	"net"
	"path/filepath"
	"strconv"
	"strings"

	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	draftlib "github.com/mediago-dev/mediago-drama/packages/jianyingdraft/pkg/jianyingdraft"
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
	servicejianyingdraft "github.com/mediago-dev/mediago-drama/services/server/internal/service/jianyingdraft"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	serviceprojectasset "github.com/mediago-dev/mediago-drama/services/server/internal/service/projectasset"
	serviceprompt "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"
	servicepromptlibrary "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	serviceprompttemplates "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
	servicesettings "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
	serviceworkspaceevent "github.com/mediago-dev/mediago-drama/services/server/internal/service/workspaceevent"
)

func newAPIHandler(config Config) *apiHandler {
	shutdownCtx, shutdownCancel := context.WithCancel(context.Background())
	workspaceState := appworkspace.NewStateService(config.WorkspaceDir)
	config.WorkspaceDir = workspaceState.Dir()
	settingsDBPath := config.SettingsDBPath
	if settingsDBPath == "" {
		settingsDBPath = workspaceState.SettingsDatabasePath()
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
	if settingsReposErr == nil && config.SettingsDBPath == "" {
		migrateDefaultSettingsDB(settingsRepos.DB, workspaceState.DatabasePath(), settingsDBPath)
	}
	workspaceRepos, workspaceReposErr := repository.OpenWorkspaceRepositories(workspaceState.DatabasePath())
	settings := servicesettings.NewSettingsWithStores(
		settingsRepos.APIKeys,
		settingsRepos.AgentModelProfiles,
		settingsRepos.AppSettings,
	)
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
	generationNotifications := servicegeneration.NewGenerationNotificationServiceFromRepository(workspaceRepos.GenerationNotifications, workspaceReposErr, randomID)
	generationTasks := servicegeneration.NewGenerationTaskServiceFromRepository(workspaceRepos.GenerationTasks, workspaceReposErr, randomID)
	mediaAssets := servicemedia.NewMediaAssetsFromRepository(workspaceRepos.MediaAssets, mediaDir, workspaceState.Dir(), workspaceRepos.Workspace, workspaceReposErr)
	mediaAssets.SetMediaToolPaths(config.FFmpegPath, config.FFmpegBinDir)
	previewStreamer := servicemedia.NewFFmpegPreviewStreamer(config.FFmpegPath, config.FFmpegBinDir)
	jianyingDraft := servicejianyingdraft.NewService(
		workspaceState,
		mediaAssets,
		settings,
		draftlib.FFProbeReader{BinDir: config.FFmpegBinDir},
	)
	generationService := servicegeneration.NewGenerationService(settings, generationTasks, mediaAssets, generationPreferences)
	generationService.SetJimengCLIPaths(config.JimengBinPath, config.JimengBinDir)
	generationService.SetGenerationNotifications(generationNotifications)
	generationService.SetDocumentResolver(workspaceState.StateService().Documents)
	promptTemplates := serviceprompttemplates.NewServiceFromRepository(settingsRepos.Instructions, settingsReposErr)
	serviceprompt.SetPromptTemplateStore(promptTemplates)
	promptPack := servicepromptpack.NewServiceFromRepositoryWithPackFilesDir(
		settingsRepos.Packs,
		settingsRepos.PromptLibrary,
		settingsReposErr,
		filepath.Join(filepath.Dir(settingsDBPath), "packs"),
	)
	serviceskill.SetPromptPackStore(promptPack)
	skillRegistry := serviceskill.NewRegistryWithStore(promptPack)
	promptLibrary := servicepromptlibrary.NewServiceFromPromptPack(promptPack, settingsReposErr)
	capabilityRegistry := corecapability.Default()
	capabilityService := servicecapability.NewService(capabilityRegistry, generationService.RouteConfigured)
	billingPrices := config.BillingPrices
	if billingPrices == nil {
		billingPrices = corepricing.Default()
	}
	billingService := servicebilling.NewService(workspaceRepos.Billing, billingPrices, capabilityRegistry)
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
		jianyingDraft:    jianyingDraft,
		mediaAssets:      mediaAssets,
		previewStreamer:  previewStreamer,
		projectAssets:    projectAssets,
		promptPack:       promptPack,
		promptTemplates:  promptTemplates,
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
