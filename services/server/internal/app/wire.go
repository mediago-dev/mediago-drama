package app

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	draftlib "github.com/mediago-dev/mediago-drama/packages/jianyingdraft/pkg/jianyingdraft"
	appagent "github.com/mediago-dev/mediago-drama/services/server/internal/app/agent"
	appevents "github.com/mediago-dev/mediago-drama/services/server/internal/app/events"
	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicecapability "github.com/mediago-dev/mediago-drama/services/server/internal/service/capability"
	serviceruntime "github.com/mediago-dev/mediago-drama/services/server/internal/service/codex"
	servicecodexskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/codexskill"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	servicejianyingdraft "github.com/mediago-dev/mediago-drama/services/server/internal/service/jianyingdraft"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	serviceprojectasset "github.com/mediago-dev/mediago-drama/services/server/internal/service/projectasset"
	serviceprompt "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompt"
	servicepromptlibrary "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	serviceprompttemplates "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
	servicesettings "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
	servicetextcompletion "github.com/mediago-dev/mediago-drama/services/server/internal/service/textcompletion"
	serviceusage "github.com/mediago-dev/mediago-drama/services/server/internal/service/usage"
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

	backendService := serviceagent.NewAgentBackendServiceWithBinDir(config.CodexPath, config.AgentBinDir, config.AgentID)
	buildPrompt := func(request agentRunRequest) string {
		return buildRuntimePromptWithMaxSectionChars(request, config.PromptMaxSectionChars)
	}
	runner := config.agentRunner
	if runner == nil {
		runner = appagent.NewRuntimeRunnerWithDocumentMCPConfigPathAndArgv(
			config.CodexPath,
			config.WorkspaceDir,
			config.DocumentMCPConfigPath,
			buildPrompt,
			backendService.ActiveCommand,
			backendService.ActiveArgv,
		)
	}
	// 会话回顾数据源：续接对话的 Runtime 会话无法复用（换模型/上游会话失效）时，
	// runner 用它取本会话聊天记录和已确认的选择决定，回放进重建会话的 prompt。
	buildSessionRecap := func(ctx context.Context, request agentRunRequest) string {
		if ctx.Err() != nil {
			return ""
		}
		chat, err := workspaceState.LoadAgentChat(request.ProjectID, request.SessionID)
		if err != nil {
			return ""
		}
		decisionLines := []string{}
		if selections := workspaceState.StateService().Selections; selections != nil {
			if decided, err := selections.ListDecidedBySession(request.ProjectID, request.SessionID, 12); err == nil {
				for _, record := range decided {
					if line := serviceselection.FormatDecisionLine(record); line != "" {
						decisionLines = append(decisionLines, line)
					}
				}
			}
		}
		return serviceruntime.BuildRuntimeSessionRecap(chat.Messages, request.Prompt, decisionLines)
	}
	if recapAware, ok := runner.(interface {
		SetSessionRecapBuilder(serviceruntime.SessionRecapBuilder)
	}); ok {
		recapAware.SetSessionRecapBuilder(buildSessionRecap)
	} else {
		// 断言失败必须可见：否则回顾功能无声关闭，回归会伪装成模型行为问题。
		slog.Warn("agent runner does not accept a session recap builder; session rebuilds will lose context")
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
	var settingsMigrationErr error
	if settingsReposErr == nil && config.SettingsDBPath == "" {
		settingsMigrationErr = migrateDefaultSettingsDB(
			settingsRepos.DB,
			workspaceState.DatabasePath(),
			settingsDBPath,
		)
	}
	workspaceRepos, workspaceReposErr := repository.OpenWorkspaceRepositories(workspaceState.DatabasePath())
	settings := servicesettings.NewSettingsWithStores(
		settingsRepos.APIKeys,
		settingsRepos.AgentModelProfiles,
		settingsRepos.AppSettings,
	)
	settings.SetJimengCLIPaths(config.JimengBinPath, config.JimengBinDir)
	settings.SetLibTVCLIPaths(config.LibTVBinPath, config.LibTVBinDir)

	codexPath := ""
	if resolvedCodexPath, err := backendService.CodexExecutable(); err == nil {
		codexPath = resolvedCodexPath
		settings.SetCodexCLIPath(codexPath)
		settings.SetCodexRuntimeHome(filepath.Join(workspaceState.Dir(), ".mediago-drama", "runtime", "agents", "codex", "account-home"))
	}
	settings.SetModelPlatforms(config.ModelPlatforms)
	settings.SetGenerationCLIs(config.GenerationCLIs)

	codexSkills := servicecodexskill.NewService(
		workspaceState.Dir(),
		func(ctx context.Context) (servicecodexskill.RuntimeHomeDescriptor, error) {
			descriptor, err := settings.DescribeCodexRuntimeHome(ctx, workspaceState.Dir())
			if err != nil {
				return servicecodexskill.RuntimeHomeDescriptor{}, err
			}
			return servicecodexskill.RuntimeHomeDescriptor{
				CodexHome: descriptor.CodexHome,
				Isolated:  descriptor.Isolated,
			}, nil
		},
	)
	agentBridgeURL := strings.TrimSpace(config.AgentBridgeURL)
	if agentBridgeURL == "" {
		agentBridgeURL = defaultAgentBridgeURL(config.Host, config.Port)
	}
	if configurableRunner, ok := runner.(interface {
		SetProcessConfigProvider(serviceruntime.ProcessConfigProvider)
	}); ok {
		configurableRunner.SetProcessConfigProvider(serviceruntime.ProcessConfigProviderFunc(func(ctx context.Context, request serviceruntime.ProcessConfigRequest) (serviceruntime.ProcessConfig, error) {
			profile, err := settings.PrepareCodexRelayRuntimeConfig(ctx, request.WorkspaceDir, codexRelayBridgeBaseURL(agentBridgeURL)+"/api/v1/codex-relay")
			if err != nil {
				return serviceruntime.ProcessConfig{}, err
			}
			env := mergeRuntimeProcessEnv(profile.Env, backendService.ActiveEnv())
			if env["CODEX_HOME"] == "" {
				env["CODEX_HOME"] = filepath.Join(request.WorkspaceDir, ".mediago-drama", "runtime", "agents", "codex", "account-home")
			}
			prepared := serviceruntime.ProcessConfig{ConfigDir: profile.ConfigDir, Env: env, NativeInstructionsInjected: true}
			if profile.Configured && request.PreferredModel == "" {
				check, err := settings.CheckCodexRelay(ctx, servicesettings.CodexRelayCheckRequest{})
				if err == nil && len(check.Models) > 0 {
					prepared.RestrictModelValues = true
					prepared.AllowedModelValues = check.Models
					prepared.DiscoveredModelValues = check.Models
				}
			}
			return prepared, nil
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
	if codexPath != "" {
		generationService.SetCodexTextBackend(
			servicetextcompletion.NewCodexBackend(codexPath, workspaceState.Dir()),
			func(ctx context.Context, _ servicetextcompletion.Request) bool {
				status, err := settings.GetCodexAccount(ctx)
				return err == nil && status.Status == "loggedIn"
			},
		)
	}
	generationService.SetJimengCLIPaths(config.JimengBinPath, config.JimengBinDir)
	generationService.SetLibTVCLIConfig(config.LibTVBinPath, config.LibTVBinDir, config.LibTVProjectID)

	generationService.SetGenerationNotifications(generationNotifications)
	generationService.SetDocumentResolver(workspaceState.StateService().Documents)
	workspaceState.StateService().Documents.SetGeneratedAssetCounter(generationTasks)
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
	generationService.SetStylePromptLibrary(promptLibrary)
	capabilityRegistry := corecapability.Default()
	capabilityService := servicecapability.NewService(capabilityRegistry, generationService.RouteConfigured)
	usageService := serviceusage.NewService(workspaceRepos.Usage, capabilityRegistry)
	projectAssets := serviceprojectasset.NewProjectAssetsFromRepository(workspaceRepos.ProjectAssets, mediaDir, workspaceState.Dir(), workspaceRepos.Workspace, workspaceReposErr)
	selectionService := serviceselection.NewService(workspaceRepos.Selections, workspaceReposErr)
	events := appevents.NewBroker(workspaceState.AppendAgentEvent)
	workspaceEvents := serviceworkspaceevent.NewBroker()
	agentSessions := appagent.NewSessionService(workspaceState)
	selectionService.SetRunDecisionGuard(agentSessions)
	if documentSelections := workspaceState.StateService().Selections; documentSelections != nil {
		documentSelections.SetRunDecisionGuard(agentSessions)
	}

	handler := &apiHandler{
		initErr: errors.Join(
			workspaceState.InitErr(),
			settingsReposErr,
			settingsMigrationErr,
			workspaceReposErr,
		),
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
		usage:            usageService,
		backendService:   backendService,
		generation:       generationService,
		selection:        selectionService,
		jianyingDraft:    jianyingDraft,
		mediaAssets:      mediaAssets,
		previewStreamer:  previewStreamer,
		projectAssets:    projectAssets,
		promptPack:       promptPack,
		promptTemplates:  promptTemplates,
		promptLibrary:    promptLibrary,
		skillRegistry:    skillRegistry,
		codexSkills:      codexSkills,
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
			RunTerminalHandler: func(event serviceagent.AgentRunTerminalEvent) {
				var (
					count int64
					err   error
				)
				if event.Status == "cancelled" {
					count, err = selectionService.CancelPendingByRun(event.ProjectID, event.RunID)
				} else {
					count, err = selectionService.ExpirePendingByRun(event.ProjectID, event.RunID)
				}
				if err != nil {
					slog.Warn(
						"finishing pending selections for terminal agent run failed",
						"session_id", event.SessionID,
						"run_id", event.RunID,
						"project_id", event.ProjectID,
						"status", event.Status,
						"error", err,
					)
					return
				}
				if count > 0 {
					slog.Info(
						"finished pending selections for terminal agent run",
						"session_id", event.SessionID,
						"run_id", event.RunID,
						"project_id", event.ProjectID,
						"status", event.Status,
						"selection_count", count,
					)
				}
			},
			SessionTitleGenerator: func(ctx context.Context, request serviceagent.AgentSessionTitleRequest) (string, error) {
				completion := servicegeneration.TextCompletionRequest{
					Prompt: request.Prompt,
					Params: map[string]any{
						"temperature": 0,
						"maxTokens":   32,
					},
				}
				if selectedModel := strings.TrimSpace(request.Model.Value); selectedModel != "" {
					routeID, model, ok := servicegeneration.TextRouteForAgentRuntimeModel(selectedModel)
					if ok {
						completion.Executor = servicetextcompletion.ExecutorRoute
						completion.RouteID = routeID
						completion.Model = model
					} else {
						completion.Executor = servicetextcompletion.ExecutorCodex
						completion.Model = selectedModel
					}
				}
				return generationService.CompleteText(ctx, completion)
			},
		},
	)
	return handler
}

func mergeRuntimeProcessEnv(base map[string]string, overrides map[string]string) map[string]string {
	merged := make(map[string]string, len(base)+len(overrides))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range overrides {
		merged[key] = value
	}
	if strings.TrimSpace(merged["CODEX_API_KEY"]) != "" || strings.TrimSpace(merged["OPENAI_API_KEY"]) != "" {
		merged["DEFAULT_AUTH_REQUEST"] = `{"methodId":"api-key"}`
	}
	return merged
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

func codexRelayBridgeBaseURL(agentBridgeURL string) string {
	agentBridgeURL = strings.TrimRight(strings.TrimSpace(agentBridgeURL), "/")
	parsed, err := url.Parse(agentBridgeURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return agentBridgeURL
	}
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}
