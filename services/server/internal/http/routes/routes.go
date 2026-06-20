package routes

import (
	"github.com/gin-gonic/gin"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	httphandlers "github.com/mediago-dev/mediago-drama/services/server/internal/http/handlers"
	serviceevents "github.com/mediago-dev/mediago-drama/services/server/internal/service/events"
)

// Handlers groups the concrete HTTP handlers used by the app router.
type Handlers struct {
	MCP                   httphandlers.MCP
	Settings              httphandlers.Settings
	Capabilities          httphandlers.Capabilities
	Billing               httphandlers.Billing
	MediaAssets           httphandlers.MediaAssets
	ProjectAssets         httphandlers.ProjectAssets
	AgentBackends         httphandlers.AgentBackends
	Projects              httphandlers.Projects
	ProjectConfigs        httphandlers.ProjectConfigs
	ProjectBriefs         httphandlers.ProjectBriefs
	Workspace             httphandlers.Workspace
	EpisodePreview        httphandlers.EpisodePreview
	WorkspaceEvents       httphandlers.WorkspaceEvents
	PromptTemplates       httphandlers.PromptTemplates
	PromptLibrary         httphandlers.PromptLibrary
	Skills                httphandlers.Skills
	DocumentToolApprovals httphandlers.DocumentToolApprovals
	AgentPermissions      httphandlers.AgentPermissions
	AgentChat             httphandlers.AgentChat
	AgentMessages         httphandlers.AgentMessages
	DocumentOperations    httphandlers.DocumentOperations
	GenerationTasks       httphandlers.GenerationTasks
	GenerationPreferences httphandlers.GenerationPreferences
	InternalEvents        httphandlers.InternalEvents
	AgentEvents           httphandlers.AgentEvents
	AgentRuntime          httphandlers.AgentRuntime
	AgentSessions         httphandlers.AgentSessions
}

// Register attaches all app routes to the provided Gin engine.
func Register(router *gin.Engine, handlers Handlers) {
	router.Any("/mcp", handlers.MCP.HandleExternalMCP)
	router.Any(mediamcp.LegacyDocumentHTTPPath, handlers.MCP.HandleLegacyDocumentMCP)

	apiRoutes := router.Group("/api/v1")
	registerCoreRoutes(apiRoutes, handlers)
	registerSettingsRoutes(apiRoutes, handlers)
	registerGenerationRoutes(apiRoutes, handlers)
	registerProjectRoutes(apiRoutes.Group("/projects/:projectId"), handlers)
}

func registerCoreRoutes(apiRoutes *gin.RouterGroup, handlers Handlers) {
	apiRoutes.GET("/health", httphandlers.HandleHealth)
	apiRoutes.GET("/capabilities", handlers.Capabilities.HandleListCapabilities)
	apiRoutes.GET("/billing/summary", handlers.Billing.HandleBillingSummary)
	apiRoutes.GET("/projects", handlers.Projects.HandleListProjects)
	apiRoutes.POST("/projects", handlers.Projects.HandleCreateProject)
	apiRoutes.GET("/prompt-templates", handlers.PromptTemplates.HandleListPromptTemplates)
	apiRoutes.PUT("/prompt-templates/:id", handlers.PromptTemplates.HandlePutPromptTemplate)
	apiRoutes.GET("/prompt-presets", handlers.PromptLibrary.HandleListPrompts)
	apiRoutes.POST("/prompt-presets", handlers.PromptLibrary.HandlePostPrompt)
	apiRoutes.GET("/prompt-presets/:id", handlers.PromptLibrary.HandleGetPrompt)
	apiRoutes.PUT("/prompt-presets/:id", handlers.PromptLibrary.HandlePutPrompt)
	apiRoutes.POST("/prompt-presets/:id/reset", handlers.PromptLibrary.HandleResetPrompt)
	apiRoutes.DELETE("/prompt-presets/:id", handlers.PromptLibrary.HandleDeletePrompt)
	apiRoutes.GET("/skills", handlers.Skills.HandleListSkills)
	apiRoutes.POST("/skills", handlers.Skills.HandlePostSkill)
	apiRoutes.GET("/skills/:name", handlers.Skills.HandleGetSkill)
	apiRoutes.PUT("/skills/:name", handlers.Skills.HandlePutSkill)
	apiRoutes.DELETE("/skills/:name", handlers.Skills.HandleDeleteSkill)
	apiRoutes.GET("/agent/backends", handlers.AgentBackends.HandleListBackends)
	apiRoutes.GET("/media-assets", handlers.MediaAssets.HandleMediaAssets)
	apiRoutes.POST("/media-assets", handlers.MediaAssets.HandleUploadMediaAsset)
	apiRoutes.POST("/media-assets/save-generated-file", handlers.MediaAssets.HandleSaveGeneratedAssetFile)
	apiRoutes.GET("/media-assets/:assetId/content", handlers.MediaAssets.HandleMediaAssetContent)
	apiRoutes.GET("/media-assets/:assetId/poster", handlers.MediaAssets.HandleMediaAssetPoster)
	apiRoutes.PUT("/media-assets/:assetId", handlers.MediaAssets.HandleUpdateMediaAsset)
	apiRoutes.DELETE("/media-assets/:assetId", handlers.MediaAssets.HandleDeleteMediaAsset)
	apiRoutes.Any("/internal/agent/document-mcp", handlers.MCP.HandleInternalDocumentMCP)
	apiRoutes.Any(
		"/internal/projects/:projectId/agent/document-mcp",
		handlers.MCP.HandleProjectDocumentMCP,
	)
	apiRoutes.POST(
		serviceevents.InternalEventsPublishRoute,
		handlers.InternalEvents.HandleInternalPublishEvent,
	)
}

func registerSettingsRoutes(apiRoutes *gin.RouterGroup, handlers Handlers) {
	apiRoutes.GET("/settings/api-keys", handlers.Settings.HandleAPIKeys)
	apiRoutes.PUT("/settings/api-keys/:provider", handlers.Settings.HandlePutAPIKey)
	apiRoutes.DELETE("/settings/api-keys/:provider", handlers.Settings.HandleDeleteAPIKey)
	apiRoutes.POST("/settings/api-keys/:provider/login", handlers.Settings.HandlePostProviderLogin)
	apiRoutes.POST(
		"/settings/api-keys/:provider/login/check",
		handlers.Settings.HandlePostProviderLoginCheck,
	)
	apiRoutes.GET(
		"/settings/agent-model-profiles",
		handlers.Settings.HandleAgentModelProfiles,
	)
	apiRoutes.POST(
		"/settings/agent-model-profiles",
		handlers.Settings.HandlePostAgentModelProfile,
	)
	apiRoutes.PATCH(
		"/settings/agent-model-profiles/:profileId",
		handlers.Settings.HandlePatchAgentModelProfile,
	)
	apiRoutes.DELETE(
		"/settings/agent-model-profiles/:profileId",
		handlers.Settings.HandleDeleteAgentModelProfile,
	)
	apiRoutes.PUT(
		"/settings/agent-model-profiles/:profileId/default",
		handlers.Settings.HandlePutAgentModelProfileDefault,
	)
	apiRoutes.PUT(
		"/settings/agent-model-profiles/:profileId/api-key",
		handlers.Settings.HandlePutAgentModelProfileAPIKey,
	)
	apiRoutes.DELETE(
		"/settings/agent-model-profiles/:profileId/api-key",
		handlers.Settings.HandleDeleteAgentModelProfileAPIKey,
	)
}

func registerGenerationRoutes(apiRoutes *gin.RouterGroup, handlers Handlers) {
	apiRoutes.GET("/generation/models", handlers.GenerationTasks.HandleGenerationModels)
	apiRoutes.POST("/generation/voice-preview", handlers.GenerationTasks.HandleGenerationVoicePreview)
	apiRoutes.GET("/generation/sessions", handlers.GenerationTasks.HandleGenerationConversations)
	apiRoutes.POST("/generation/sessions", handlers.GenerationTasks.HandleCreateGenerationConversation)
	apiRoutes.DELETE(
		"/generation/sessions/:sessionId",
		handlers.GenerationTasks.HandleDeleteGenerationConversation,
	)
	apiRoutes.GET(
		"/generation/sessions/:sessionId/preferences",
		handlers.GenerationPreferences.HandleGenerationPreferences,
	)
	apiRoutes.PUT(
		"/generation/sessions/:sessionId/preferences",
		handlers.GenerationPreferences.HandlePutGenerationPreferences,
	)
	apiRoutes.GET(
		"/generation/sessions/:sessionId/tasks",
		handlers.GenerationTasks.HandleGenerationSessionTasks,
	)
	apiRoutes.POST(
		"/generation/sessions/:sessionId/media-assets/import",
		handlers.GenerationTasks.HandleImportGenerationMediaAssets,
	)
	apiRoutes.POST(
		"/generation/sessions/:sessionId/messages",
		handlers.GenerationTasks.HandleGenerationMessage,
	)
	apiRoutes.POST(
		"/generation/sessions/:sessionId/messages/stream",
		handlers.GenerationTasks.HandleGenerationTextStream,
	)
	registerGenerationNotificationRoutes(apiRoutes, handlers.GenerationTasks, true)
	apiRoutes.GET("/generation/tasks", handlers.GenerationTasks.HandleGenerationTasks)
	apiRoutes.GET("/generation/tasks/:taskId", handlers.GenerationTasks.HandleGenerationTask)
	apiRoutes.POST(
		"/generation/tasks/:taskId/retry",
		handlers.GenerationTasks.HandleRetryGenerationTask,
	)
	apiRoutes.PATCH(
		"/generation/tasks/:taskId/assets/:assetIndex",
		handlers.GenerationTasks.HandleUpdateGenerationTaskAsset,
	)
	apiRoutes.DELETE(
		"/generation/tasks/:taskId/assets/:assetIndex",
		handlers.GenerationTasks.HandleDeleteGenerationTaskAsset,
	)
	apiRoutes.DELETE(
		"/generation/tasks/:taskId",
		handlers.GenerationTasks.HandleDeleteGenerationTask,
	)
	apiRoutes.GET(
		"/generation/tasks/:taskId/result",
		handlers.GenerationTasks.HandleGenerationVideo,
	)
}

func registerProjectRoutes(projectRoutes *gin.RouterGroup, handlers Handlers) {
	projectRoutes.DELETE("", handlers.Projects.HandleDeleteProject)
	projectRoutes.POST("/archive", handlers.Projects.HandleArchiveProject)
	projectRoutes.POST("/restore", handlers.Projects.HandleRestoreProject)
	projectRoutes.DELETE("/permanent", handlers.Projects.HandlePermanentlyDeleteProject)
	projectRoutes.GET("/billing/summary", handlers.Billing.HandleProjectBillingSummary)
	projectRoutes.GET("/config", handlers.ProjectConfigs.HandleGetProjectConfig)
	projectRoutes.PATCH("/config", handlers.ProjectConfigs.HandlePatchProjectConfig)
	projectRoutes.GET("/brief", handlers.ProjectBriefs.HandleGetProjectBrief)
	projectRoutes.PUT("/brief", handlers.ProjectBriefs.HandlePutProjectBrief)
	projectRoutes.GET("/assets", handlers.ProjectAssets.HandleProjectAssets)
	projectRoutes.POST("/assets", handlers.ProjectAssets.HandleUploadProjectAsset)
	projectRoutes.GET("/assets/:assetId/content", handlers.ProjectAssets.HandleProjectAssetContent)
	projectRoutes.PUT("/assets/:assetId", handlers.ProjectAssets.HandleUpdateProjectAsset)
	projectRoutes.DELETE("/assets/:assetId", handlers.ProjectAssets.HandleDeleteProjectAsset)
	projectRoutes.GET("/media-assets", handlers.MediaAssets.HandleProjectMediaAssets)
	projectRoutes.POST("/media-assets", handlers.MediaAssets.HandleUploadProjectMediaAsset)
	projectRoutes.GET("/media-assets/:assetId/content", handlers.MediaAssets.HandleProjectMediaAssetContent)
	projectRoutes.GET("/media-assets/:assetId/poster", handlers.MediaAssets.HandleProjectMediaAssetPoster)
	projectRoutes.PUT("/media-assets/:assetId", handlers.MediaAssets.HandleUpdateProjectMediaAsset)
	projectRoutes.DELETE("/media-assets/:assetId", handlers.MediaAssets.HandleDeleteProjectMediaAsset)
	projectRoutes.GET(
		"/generation/selected-assets",
		handlers.GenerationTasks.HandleSelectedGenerationAssets,
	)
	registerWorkspaceRoutes(projectRoutes, handlers)
	registerAgentRoutes(projectRoutes, handlers)
	registerProjectGenerationNotificationRoutes(projectRoutes, handlers.GenerationTasks)
}

func registerWorkspaceRoutes(projectRoutes *gin.RouterGroup, handlers Handlers) {
	projectRoutes.GET("/workspace/state", handlers.Workspace.HandleGetWorkspaceState)
	projectRoutes.GET("/workspace/events", handlers.WorkspaceEvents.HandleWorkspaceEvents)
	projectRoutes.PUT("/workspace/state", handlers.Workspace.HandlePutWorkspaceState)
	projectRoutes.GET("/workspace/folders", handlers.Workspace.HandleListDocumentFolders)
	projectRoutes.POST("/workspace/folders", handlers.Workspace.HandleCreateDocumentFolder)
	projectRoutes.PATCH(
		"/workspace/folders/:folderId",
		handlers.Workspace.HandleUpdateDocumentFolder,
	)
	projectRoutes.DELETE(
		"/workspace/folders/:folderId",
		handlers.Workspace.HandleDeleteDocumentFolder,
	)
	projectRoutes.GET("/workspace/documents", handlers.Workspace.HandleListWorkspaceDocuments)
	projectRoutes.POST("/workspace/documents", handlers.Workspace.HandleCreateWorkspaceDocument)
	projectRoutes.GET(
		"/workspace/documents/:documentId/history",
		handlers.Workspace.HandleListDocumentHistory,
	)
	projectRoutes.GET(
		"/workspace/documents/:documentId/history/:commitHash",
		handlers.Workspace.HandleGetDocumentHistoryVersion,
	)
	projectRoutes.GET(
		"/workspace/documents/:documentId/history/:commitHash/diff",
		handlers.Workspace.HandleGetDocumentHistoryDiff,
	)
	projectRoutes.POST(
		"/workspace/documents/:documentId/history/:commitHash/restore",
		handlers.Workspace.HandleRestoreDocumentHistoryVersion,
	)
	projectRoutes.GET(
		"/workspace/documents/:documentId",
		handlers.Workspace.HandleGetWorkspaceDocument,
	)
	projectRoutes.PATCH(
		"/workspace/documents/:documentId",
		handlers.Workspace.HandleUpdateWorkspaceDocument,
	)
	projectRoutes.DELETE(
		"/workspace/documents/:documentId",
		handlers.Workspace.HandleDeleteWorkspaceDocument,
	)
	projectRoutes.GET(
		"/workspace/episodes/:documentId",
		handlers.Workspace.HandleGetEpisodeTimelineState,
	)
	projectRoutes.GET(
		"/workspace/episodes/:documentId/preview.mp4",
		handlers.EpisodePreview.HandleEpisodePreviewStream,
	)
	projectRoutes.PUT(
		"/workspace/episodes/:documentId",
		handlers.Workspace.HandlePutEpisodeTimelineState,
	)
}

func registerAgentRoutes(projectRoutes *gin.RouterGroup, handlers Handlers) {
	projectRoutes.GET(
		"/agent/document-tool-approvals",
		handlers.DocumentToolApprovals.HandleListDocumentToolApprovals,
	)
	projectRoutes.POST(
		"/agent/document-tool-approvals/:approvalId/decision",
		handlers.DocumentToolApprovals.HandleDecideDocumentToolApproval,
	)
	projectRoutes.POST(
		"/agent/sessions/:sessionId/permission-requests/:requestId/decision",
		handlers.AgentPermissions.HandleDecideAgentPermission,
	)
	projectRoutes.GET("/agent/chat", handlers.AgentChat.HandleGetAgentChat)
	projectRoutes.GET("/agent/sessions/:sessionId/chat", handlers.AgentChat.HandleGetAgentSessionChat)
	projectRoutes.POST("/agent/chat/messages", handlers.AgentChat.HandleAppendAgentChat)
	projectRoutes.DELETE("/agent/chat", handlers.AgentChat.HandleDeleteAgentChat)
	projectRoutes.GET("/agent/runtime-config", handlers.AgentRuntime.HandleAgentRuntimeConfig)
	projectRoutes.GET("/agent/sessions", handlers.AgentSessions.HandleListAgentSessions)
	projectRoutes.POST("/agent/sessions", handlers.AgentSessions.HandleCreateSession)
	projectRoutes.GET(
		"/agent/sessions/:sessionId/status",
		handlers.AgentSessions.HandleAgentSessionStatus,
	)
	projectRoutes.POST(
		"/agent/sessions/:sessionId/cancel",
		handlers.AgentSessions.HandleCancelAgentSession,
	)
	projectRoutes.POST(
		"/agent/sessions/:sessionId/messages",
		handlers.AgentMessages.HandleAgentMessage,
	)
	projectRoutes.GET("/agent/sessions/:sessionId/events", handlers.AgentEvents.HandleAgentEvents)
	projectRoutes.POST(
		"/agent/document-operations",
		handlers.DocumentOperations.HandleDocumentOperations,
	)
	projectRoutes.POST(
		"/agent/document-operations/test",
		handlers.DocumentOperations.HandleTestDocumentOperations,
	)
}

func registerGenerationNotificationRoutes(routes *gin.RouterGroup, handler httphandlers.GenerationTasks, includeIndividualReadRoute bool) {
	routes.GET("/generation/notifications", handler.HandleGenerationNotifications)
	routes.PATCH(
		"/generation/notifications/read",
		handler.HandleMarkAllGenerationNotificationsRead,
	)
	routes.GET(
		"/generation/notifications/events",
		handler.HandleGenerationNotificationEvents,
	)
	if !includeIndividualReadRoute {
		return
	}
	routes.PATCH(
		"/generation/notifications/:notificationId/read",
		handler.HandleMarkGenerationNotificationRead,
	)
}

func registerProjectGenerationNotificationRoutes(routes *gin.RouterGroup, handler httphandlers.GenerationTasks) {
	routes.GET("/generation/notifications", handler.HandleProjectGenerationNotifications)
	routes.PATCH(
		"/generation/notifications/read",
		handler.HandleMarkAllProjectGenerationNotificationsRead,
	)
	routes.GET(
		"/generation/notifications/events",
		handler.HandleProjectGenerationNotificationEvents,
	)
}
