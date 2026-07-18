package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"unicode/utf16"

	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	draftlib "github.com/mediago-dev/mediago-drama/packages/jianyingdraft/pkg/jianyingdraft"
	appagent "github.com/mediago-dev/mediago-drama/services/server/internal/app/agent"
	appevents "github.com/mediago-dev/mediago-drama/services/server/internal/app/events"
	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	corecapability "github.com/mediago-dev/mediago-drama/services/server/internal/capability"
	platformprotectedpack "github.com/mediago-dev/mediago-drama/services/server/internal/platform/protectedpack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceacp "github.com/mediago-dev/mediago-drama/services/server/internal/service/acp"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicebilling "github.com/mediago-dev/mediago-drama/services/server/internal/service/billing"
	servicecapability "github.com/mediago-dev/mediago-drama/services/server/internal/service/capability"
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
	// 会话回顾数据源：续接对话的 ACP 会话无法复用（换模型/上游会话失效）时，
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
		return serviceacp.BuildACPSessionRecap(chat.Messages, request.Prompt, decisionLines)
	}
	if recapAware, ok := runner.(interface {
		SetSessionRecapBuilder(serviceacp.SessionRecapBuilder)
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
	settings.SetPippitCLIPaths(config.PippitBinPath, config.PippitBinDir)
	if codexPath, err := backendService.CodexExecutable(); err == nil {
		settings.SetCodexCLIPath(codexPath)
	}
	settings.SetModelPlatforms(config.ModelPlatforms)
	settings.SetGenerationCLIs(config.GenerationCLIs)
	settings.SetMediagoBaseURL(config.MediagoBaseURL)
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
		SetProcessConfigProvider(serviceacp.ProcessConfigProvider)
	}); ok {
		configurableRunner.SetProcessConfigProvider(serviceacp.ProcessConfigProviderFunc(func(ctx context.Context, request serviceacp.ProcessConfigRequest) (serviceacp.ProcessConfig, error) {
			nativeInstructions := useNativeACPInstructions(config.PromptDelivery)
			if request.AgentID == "codex" {
				codexConfig, err := settings.PrepareCodexRelayRuntimeConfig(
					ctx,
					request.WorkspaceDir,
					codexRelayBridgeBaseURL(agentBridgeURL)+"/api/v1/codex-relay",
				)
				if err != nil {
					return serviceacp.ProcessConfig{}, err
				}
				env := mergeACPProcessEnv(codexConfig.Env, backendService.ActiveEnv())
				if nativeInstructions {
					env, err = withCodexDeveloperInstructions(env, request.FixedInstructions)
					if err != nil {
						return serviceacp.ProcessConfig{}, err
					}
				}
				processConfig := serviceacp.ProcessConfig{
					ConfigDir:                  codexConfig.ConfigDir,
					Env:                        env,
					NativeInstructionsInjected: nativeInstructions,
				}
				if strings.TrimSpace(request.PreferredModel) == "" {
					check, checkErr := settings.CheckCodexRelay(ctx, servicesettings.CodexRelayCheckRequest{})
					if checkErr == nil && len(check.Models) > 0 {
						processConfig.RestrictModelValues = true
						processConfig.AllowedModelValues = append([]string(nil), check.Models...)
						processConfig.DiscoveredModelValues = append([]string(nil), check.Models...)
					}
				}
				return processConfig, nil
			}
			if request.AgentID != "opencode" {
				return serviceacp.ProcessConfig{}, nil
			}
			var openCodeConfig servicesettings.OpenCodeRuntimeConfig
			var err error
			if nativeInstructions {
				openCodeConfig, err = settings.PrepareOpenCodeRuntimeConfigForModelAndInstructions(
					ctx,
					request.WorkspaceDir,
					request.PreferredModel,
					request.FixedInstructions,
				)
			} else {
				openCodeConfig, err = settings.PrepareOpenCodeRuntimeConfigForModel(ctx, request.WorkspaceDir, request.PreferredModel)
			}
			if err != nil {
				return serviceacp.ProcessConfig{}, err
			}
			return serviceacp.ProcessConfig{
				ConfigDir:                  openCodeConfig.ConfigDir,
				Env:                        openCodeConfig.Env,
				ProfileCount:               openCodeConfig.ProfileCount,
				DefaultProfileID:           openCodeConfig.DefaultProfileID,
				RestrictModelValues:        openCodeConfig.RestrictModelValues,
				AllowedModelValues:         openCodeConfig.AllowedModelValues,
				AllowedModelProviders:      openCodeConfig.AllowedModelProviders,
				NativeInstructionsInjected: nativeInstructions,
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
	generationService.SetLibTVCLIConfig(config.LibTVBinPath, config.LibTVBinDir, config.LibTVProjectID)
	generationService.SetPippitCLIPaths(config.PippitBinPath, config.PippitBinDir)
	generationService.SetMediagoBaseURL(config.MediagoBaseURL)
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
	promptPack.SetUnprotectedImportAllowed(config.AllowUnprotectedPackImport)
	var protectedPackImporterErr error
	if importerPath := strings.TrimSpace(config.ProtectedPackImporterPath); importerPath != "" {
		var importer *platformprotectedpack.Importer
		importer, protectedPackImporterErr = platformprotectedpack.New(
			importerPath,
			config.ProtectedPackImporterSHA256,
		)
		if protectedPackImporterErr == nil {
			promptPack.SetProtectedImporter(importer)
		} else {
			promptPack.SetProtectedImporterUnavailable(protectedPackImporterErr)
		}
	}
	serviceskill.SetPromptPackStore(promptPack)
	skillRegistry := serviceskill.NewRegistryWithStore(promptPack)
	promptLibrary := servicepromptlibrary.NewServiceFromPromptPack(promptPack, settingsReposErr)
	generationService.SetStylePromptLibrary(promptLibrary)
	for _, extension := range config.RuntimeExtensions {
		if extension != nil && extension.ContentUseAuthorizer() != nil {
			generationService.SetContentUseAuthorizer(extension.ContentUseAuthorizer())
		}
	}
	capabilityRegistry := corecapability.Default()
	capabilityService := servicecapability.NewService(capabilityRegistry, generationService.RouteConfigured)
	billingPrices := config.BillingPrices
	if billingPrices == nil {
		billingPrices = corepricing.Default()
	}
	billingService := servicebilling.NewService(workspaceRepos.Billing, billingPrices, capabilityRegistry)
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
			protectedPackImporterErr,
		),
		workspaceState:    workspaceState,
		events:            events,
		workspaceEvents:   workspaceEvents,
		agentSessions:     agentSessions,
		agentRunner:       runner,
		documentRunner:    documentRunner,
		agentRunTimeout:   agentRunTimeout,
		agentBridgeURL:    agentBridgeURL,
		agentBridgeToken:  agentBridgeToken,
		settings:          settings,
		capability:        capabilityService,
		billing:           billingService,
		backendService:    backendService,
		generation:        generationService,
		selection:         selectionService,
		jianyingDraft:     jianyingDraft,
		mediaAssets:       mediaAssets,
		previewStreamer:   previewStreamer,
		projectAssets:     projectAssets,
		promptPack:        promptPack,
		promptTemplates:   promptTemplates,
		promptLibrary:     promptLibrary,
		skillRegistry:     skillRegistry,
		codexSkills:       codexSkills,
		runtimeExtensions: append([]RuntimeExtension(nil), config.RuntimeExtensions...),
		shutdownCtx:       shutdownCtx,
		shutdownCancel:    shutdownCancel,
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
					if !ok {
						return "", fmt.Errorf("selected agent model %q is unavailable for title generation", selectedModel)
					}
					completion.RouteID = routeID
					completion.Model = model
				}
				return generationService.CompleteText(ctx, completion)
			},
		},
	)
	return handler
}

func mergeACPProcessEnv(base map[string]string, overrides map[string]string) map[string]string {
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

func useNativeACPInstructions(delivery string) bool {
	return !strings.EqualFold(strings.TrimSpace(delivery), "inline")
}

func withCodexDeveloperInstructions(env map[string]string, instructions string) (map[string]string, error) {
	return withCodexDeveloperInstructionsForGOOS(env, instructions, runtime.GOOS)
}

const windowsEnvironmentVariableMaxUTF16CodeUnits = 32767

func withCodexDeveloperInstructionsForGOOS(env map[string]string, instructions string, targetGOOS string) (map[string]string, error) {
	result := make(map[string]string, len(env)+1)
	for key, value := range env {
		result[key] = value
	}
	rawConfig, exists := result["CODEX_CONFIG"]
	if !exists {
		rawConfig = os.Getenv("CODEX_CONFIG")
	}
	mergedConfig, err := mergeCodexConfigWithDeveloperInstructions(rawConfig, instructions)
	if err != nil {
		return nil, err
	}
	if err := validateCodexConfigEnvironmentSize(mergedConfig, targetGOOS); err != nil {
		return nil, err
	}
	result["CODEX_CONFIG"] = mergedConfig
	return result, nil
}

func validateCodexConfigEnvironmentSize(config string, targetGOOS string) error {
	if targetGOOS != "windows" {
		return nil
	}
	jsonCodeUnits := utf16CodeUnitCount(config)
	// A Windows environment entry contains NAME=VALUE followed by a terminating NUL.
	entryCodeUnits := utf16CodeUnitCount("CODEX_CONFIG="+config) + 1
	if entryCodeUnits <= windowsEnvironmentVariableMaxUTF16CodeUnits {
		return nil
	}
	return fmt.Errorf(
		"injecting native Codex developer instructions: CODEX_CONFIG JSON requires %d UTF-16 code units (%d including environment entry overhead) on Windows, exceeding the %d-unit limit; shorten the fixed Agent instructions or set prompt.instruction_delivery to inline",
		jsonCodeUnits,
		entryCodeUnits,
		windowsEnvironmentVariableMaxUTF16CodeUnits,
	)
}

func utf16CodeUnitCount(value string) int {
	return len(utf16.Encode([]rune(value)))
}

func mergeCodexConfigWithDeveloperInstructions(rawConfig string, instructions string) (string, error) {
	config := map[string]json.RawMessage{}
	if strings.TrimSpace(rawConfig) != "" {
		if err := json.Unmarshal([]byte(rawConfig), &config); err != nil {
			return "", fmt.Errorf("parsing CODEX_CONFIG as a JSON object: %w", err)
		}
		if config == nil {
			return "", fmt.Errorf("parsing CODEX_CONFIG as a JSON object: value must not be null")
		}
	}
	rawInstructions, err := json.Marshal(instructions)
	if err != nil {
		return "", fmt.Errorf("encoding Codex developer instructions: %w", err)
	}
	config["developer_instructions"] = rawInstructions
	encoded, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("encoding CODEX_CONFIG: %w", err)
	}
	return string(encoded), nil
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
