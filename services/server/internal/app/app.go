package app

import (
	"context"
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
	MediagoBaseURL           string
	FFmpegPath               string
	FFmpegBinDir             string
	JimengBinPath            string
	JimengBinDir             string
	DocumentMCPConfigPath    string
	AgentBridgeURL           string
	AgentBridgeToken         string
	AgentRunTimeout          time.Duration
	PromptMaxSectionChars    int
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
	promptTemplateHandler := httphandlers.NewPromptTemplates(api.promptTemplates)
	promptLibraryHandler := httphandlers.NewPromptLibrary(api.promptLibrary)
	skillHandler := httphandlers.NewSkills(api.skillRegistry)
	approvalHandler := httphandlers.NewDocumentToolApprovals(api.workspaceState, repository.IsRecordNotFound)
	permissionHandler := httphandlers.NewAgentPermissions(api)
	chatHandler := httphandlers.NewAgentChat(api.workspaceState, api.PendingAgentPermissions)
	messageHandler := httphandlers.NewAgentMessages(api)
	documentOperationsHandler := httphandlers.NewDocumentOperations(api)
	generationTaskHandler := httphandlers.NewGenerationTasks(api.generation)
	generationPreferenceHandler := httphandlers.NewGenerationPreferences(api.generation)
	internalEventHandler := httphandlers.NewInternalEvents(api.agentBridgeToken, api)
	agentEventHandler := httphandlers.NewAgentEvents(api)
	runtimeHandler := httphandlers.NewAgentRuntime(func(ctx context.Context, projectID string) (agentRuntimeConfigResponse, error) {
		inspector, ok := api.agentRunner.(agentRuntimeConfigInspector)
		if !ok {
			return agentRuntimeConfigResponse{}, nil
		}
		projectDir, err := api.workspaceState.StateService().Documents.ProjectDir(projectID)
		if err != nil {
			return agentRuntimeConfigResponse{}, err
		}
		return inspector.InspectSessionConfig(ctx, projectID, projectDir)
	})
	sessionHandler := httphandlers.NewAgentSessions(api.agentSessions, randomID, func(status agentSessionStatus) {
		api.events.Publish(agentEvent{
			ID:        mustRandomID("event"),
			SessionID: status.SessionID,
			Type:      "agent.run.cancelled",
			Message:   "Agent 运行已中断。",
			CreatedAt: timestamp.NowRFC3339Nano(),
		})
	}, api.AgentSessionStatus)

	httproutes.Register(router, httproutes.Handlers{
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
		PromptTemplates:       promptTemplateHandler,
		PromptLibrary:         promptLibraryHandler,
		Skills:                skillHandler,
		DocumentToolApprovals: approvalHandler,
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

func writeError(context *gin.Context, status int, message string) {
	httpresponse.Error(context, status, message)
}
