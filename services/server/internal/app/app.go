package app

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	corepricing "github.com/mediago-dev/mediago-drama/packages/core/pkg/pricing"
	appmcp "github.com/mediago-dev/mediago-drama/services/server/internal/app/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	httphandlers "github.com/mediago-dev/mediago-drama/services/server/internal/http/handlers"
	"github.com/mediago-dev/mediago-drama/services/server/internal/http/middleware"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	httproutes "github.com/mediago-dev/mediago-drama/services/server/internal/http/routes"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var errAgentRuntimeConfigInspectionUnsupported = errors.New("agent runner does not support runtime config inspection")

// Config controls local server persistence and runtime behavior.
type Config struct {
	Host                     string
	Port                     int
	SettingsDBPath           string
	MediaDir                 string
	WorkspaceDir             string
	ACPCommand               string
	AgentID                  string
	AgentBinDir              string
	ModelPlatforms           []string
	GenerationCLIs           []string
	MediagoBaseURL           string
	FFmpegPath               string
	FFmpegBinDir             string
	JimengBinPath            string
	JimengBinDir             string
	LibTVBinPath             string
	LibTVBinDir              string
	LibTVProjectID           string
	PippitBinPath            string
	PippitBinDir             string
	DocumentMCPConfigPath    string
	AgentBridgeURL           string
	AgentBridgeToken         string
	AgentRunTimeout          time.Duration
	PromptMaxSectionChars    int
	PromptDelivery           string
	DisableGenerationWorker  bool
	GenerationWorkerInterval time.Duration
	GenerationWorkerLimit    int
	DisableWorkspaceWatcher  bool
	WorkspaceWatcherInterval time.Duration
	BillingPrices            corepricing.Table
	agentRunner              agentRunner
	documentOperationRunner  documentOperationRunner
}

// NewHandler returns an HTTP handler for a client-side rendered SPA.
func NewHandler(staticFS fs.FS) http.Handler {
	return NewHandlerWithConfig(staticFS, Config{})
}

// Handler serves HTTP and owns background app resources.
type Handler struct {
	http.Handler
	api *apiHandler
}

// Close stops app workers and flushes buffered resources.
func (handler *Handler) Close() error {
	if handler == nil || handler.api == nil {
		return nil
	}
	return handler.api.Close()
}

// NewHandlerWithConfig returns an HTTP handler with explicit server config.
func NewHandlerWithConfig(staticFS fs.FS, config Config) http.Handler {
	gin.SetMode(gin.ReleaseMode)

	api := newAPIHandler(config)
	if !config.DisableGenerationWorker {
		api.startGenerationWorker(config)
	}
	if !config.DisableWorkspaceWatcher {
		api.startWorkspaceFileWatcher(config)
	}
	mcpHandler := httphandlers.NewMCP(api.agentBridgeToken, func(_ *http.Request) *mcp.Server {
		server, _, err := appmcp.NewExternalServerWithSkillRegistry(api.workspaceState.Dir(), "http", api.events, api.skillRegistry)
		if err != nil {
			slog.Error(
				"external mcp http server unavailable",
				"workspace_dir", api.workspaceState.Dir(),
				"error", err,
			)
			return nil
		}
		return server
	}, func(request *http.Request, projectID string) *mcp.Server {
		config := appmcp.DocumentMCPConfigFromHTTPRequest(request, api)
		server, _, err := appmcp.NewDocumentServerWithSkillRegistry(api.workspaceState.Dir(), projectID, config, "http", api.skillRegistry)
		if err != nil {
			slog.Error(
				"document mcp http server unavailable",
				"project_id", domain.DiagnosticProjectID(projectID),
				"session_id", config.SessionID,
				"run_id", config.RunID,
				"error", err,
			)
			return nil
		}
		return server
	}, func(request *http.Request, projectID string) *mcp.Server {
		query := request.URL.Query()
		server, _, err := appmcp.NewAgentGenerationServer(
			api.workspaceState.Dir(),
			projectID,
			api.generation,
			appmcp.GenerationRunContext{
				SessionID:  query.Get("sessionId"),
				RunID:      query.Get("runId"),
				Selections: api.selection,
			},
			"http",
		)
		if err != nil {
			slog.Error(
				"generation mcp http server unavailable",
				"project_id", domain.DiagnosticProjectID(projectID),
				"error", err,
			)
			return nil
		}
		return server
	})
	router := gin.New()
	router.Use(middleware.LocalCORS(), middleware.RequestID(), middleware.RequestLogger(), middleware.RecoveryLogger(writeError))
	settingsHandler := httphandlers.NewSettings(api.settings)
	capabilityHandler := httphandlers.NewCapabilities(api.capability)
	billingHandler := httphandlers.NewBilling(api.billing)
	mediaHandler := httphandlers.NewMediaAssets(api.mediaAssets)
	projectAssetHandler := httphandlers.NewProjectAssets(api.projectAssets)
	backendsHandler := httphandlers.NewAgentBackends(api.backendService)
	projectHandler := httphandlers.NewProjects(api.workspaceState, randomID)
	projectConfigHandler := httphandlers.NewProjectConfigs(api.workspaceState)
	projectBriefHandler := httphandlers.NewProjectBriefs(api.workspaceState, api.publishProjectBriefUpdated)
	workspaceHandler := httphandlers.NewWorkspace(api.workspaceState, repository.IsRecordNotFound, servicedocument.IsWorkspaceVersionConflict, api.projectAssets)
	episodePreviewHandler := httphandlers.NewEpisodePreview(api.workspaceState, api.mediaAssets, api.previewStreamer)
	jianyingDraftHandler := httphandlers.NewJianyingDraft(api.jianyingDraft)
	workspaceEventHandler := httphandlers.NewWorkspaceEvents(api)
	promptPackHandler := httphandlers.NewPromptPacks(api.promptPack)
	licenseHandler := httphandlers.NewLicense(api.licenseClient)
	promptTemplateHandler := httphandlers.NewPromptTemplates(api.promptTemplates)
	promptLibraryHandler := httphandlers.NewPromptLibrary(api.promptLibrary)
	skillHandler := httphandlers.NewSkills(api.skillRegistry)
	codexSkillHandler := httphandlers.NewCodexSkills(api.codexSkills)
	approvalHandler := httphandlers.NewDocumentToolApprovals(api.workspaceState, repository.IsRecordNotFound)
	selectionHandler := httphandlers.NewAgentSelections(api.selection, repository.IsRecordNotFound)
	permissionHandler := httphandlers.NewAgentPermissions(api)
	chatHandler := httphandlers.NewAgentChat(api.workspaceState, api.PendingAgentPermissions)
	messageHandler := httphandlers.NewAgentMessages(api)
	documentOperationsHandler := httphandlers.NewDocumentOperations(api)
	generationTaskHandler := httphandlers.NewGenerationTasks(api.generation)
	generationPreferenceHandler := httphandlers.NewGenerationPreferences(api.generation)
	internalEventHandler := httphandlers.NewInternalEvents(api.agentBridgeToken, api)
	agentEventHandler := httphandlers.NewAgentEvents(api)
	runtimeHandler := httphandlers.NewAgentRuntime(newAgentRuntimeConfigInspector(api))
	sessionHandler := httphandlers.NewAgentSessions(api.agentSessions, randomID, func(status agentSessionStatus) {
		if api.selection != nil && strings.TrimSpace(status.RunID) != "" {
			count, err := api.selection.CancelPendingByRun(status.ProjectID, status.RunID)
			if err != nil {
				slog.Warn(
					"cancelling pending selections with agent run failed",
					"session_id", status.SessionID,
					"run_id", status.RunID,
					"project_id", status.ProjectID,
					"error", err,
				)
			} else if count > 0 {
				slog.Info(
					"cancelled pending selections with agent run",
					"session_id", status.SessionID,
					"run_id", status.RunID,
					"project_id", status.ProjectID,
					"selection_count", count,
				)
			}
		}
		api.events.Publish(agentEvent{
			ID:        mustRandomID("event"),
			SessionID: status.SessionID,
			ProjectID: status.ProjectID,
			RunID:     status.RunID,
			Type:      "agent.run.cancelled",
			Message:   "Agent 运行已中断。",
			CreatedAt: timestamp.NowRFC3339Nano(),
		})
	}, api.AgentSessionStatus)

	healthHandler := httphandlers.NewHealth(api.ReadinessError)

	httproutes.Register(router, httproutes.Handlers{
		Health:                healthHandler,
		MCP:                   mcpHandler,
		Settings:              settingsHandler,
		Capabilities:          capabilityHandler,
		Billing:               billingHandler,
		MediaAssets:           mediaHandler,
		ProjectAssets:         projectAssetHandler,
		AgentBackends:         backendsHandler,
		Projects:              projectHandler,
		ProjectConfigs:        projectConfigHandler,
		ProjectBriefs:         projectBriefHandler,
		Workspace:             workspaceHandler,
		EpisodePreview:        episodePreviewHandler,
		JianyingDraft:         jianyingDraftHandler,
		WorkspaceEvents:       workspaceEventHandler,
		PromptPacks:           promptPackHandler,
		License:               licenseHandler,
		PromptTemplates:       promptTemplateHandler,
		PromptLibrary:         promptLibraryHandler,
		Skills:                skillHandler,
		CodexSkills:           codexSkillHandler,
		DocumentToolApprovals: approvalHandler,
		AgentSelections:       selectionHandler,
		AgentPermissions:      permissionHandler,
		AgentChat:             chatHandler,
		AgentMessages:         messageHandler,
		DocumentOperations:    documentOperationsHandler,
		GenerationTasks:       generationTaskHandler,
		GenerationPreferences: generationPreferenceHandler,
		InternalEvents:        internalEventHandler,
		AgentEvents:           agentEventHandler,
		AgentRuntime:          runtimeHandler,
		AgentSessions:         sessionHandler,
	})
	registerDevelopmentDocs(router)

	static := httphandlers.NewSPA(staticFS)
	router.NoRoute(func(context *gin.Context) {
		if strings.HasPrefix(context.Request.URL.Path, "/api/") {
			writeError(context, http.StatusNotFound, "api route not found")
			return
		}

		static.Serve(context)
	})

	return &Handler{Handler: router, api: api}
}

func newAgentRuntimeConfigInspector(api *apiHandler) httphandlers.AgentRuntimeConfigInspector {
	return func(ctx context.Context, projectID string) (agentRuntimeConfigResponse, error) {
		if api == nil {
			return agentRuntimeConfigResponse{}, errAgentRuntimeConfigInspectionUnsupported
		}
		inspector, ok := api.agentRunner.(agentRuntimeConfigInspector)
		if !ok {
			return agentRuntimeConfigResponse{}, errAgentRuntimeConfigInspectionUnsupported
		}
		projectDir, err := api.workspaceState.StateService().Documents.ProjectDir(projectID)
		if err != nil {
			return agentRuntimeConfigResponse{}, err
		}
		return inspector.InspectSessionConfig(ctx, projectID, projectDir)
	}
}

func writeError(context *gin.Context, status int, message string) {
	httpresponse.Error(context, status, message)
}
