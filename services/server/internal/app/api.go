package app

import (
	"context"
	"sync"
	"time"

	appevents "github.com/mediago-dev/mediago-drama/services/server/internal/app/events"
	appworkspace "github.com/mediago-dev/mediago-drama/services/server/internal/app/workspace"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	serviceagent "github.com/mediago-dev/mediago-drama/services/server/internal/service/agent"
	servicebilling "github.com/mediago-dev/mediago-drama/services/server/internal/service/billing"
	servicecapability "github.com/mediago-dev/mediago-drama/services/server/internal/service/capability"
	servicedocument "github.com/mediago-dev/mediago-drama/services/server/internal/service/document"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	servicejianyingdraft "github.com/mediago-dev/mediago-drama/services/server/internal/service/jianyingdraft"
	servicelicense "github.com/mediago-dev/mediago-drama/services/server/internal/service/license"
	servicemedia "github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
	serviceprojectasset "github.com/mediago-dev/mediago-drama/services/server/internal/service/projectasset"
	servicepromptlibrary "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptlibrary"
	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
	serviceprompttemplates "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
	serviceselection "github.com/mediago-dev/mediago-drama/services/server/internal/service/selection"
	servicesettings "github.com/mediago-dev/mediago-drama/services/server/internal/service/settings"
	serviceshared "github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
	serviceskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/skill"
	serviceworkspaceevent "github.com/mediago-dev/mediago-drama/services/server/internal/service/workspaceevent"
)

type apiHandler struct {
	workspaceState   *appworkspace.WorkspaceStateService
	events           *appevents.Broker
	workspaceEvents  *serviceworkspaceevent.Broker
	agentSessions    *agentSessionService
	agentRunner      agentRunner
	documentRunner   documentOperationRunner
	agentRunTimeout  time.Duration
	agentBridgeURL   string
	agentBridgeToken string
	agentRuntime     *serviceagent.AgentRuntime
	backendService   *serviceagent.AgentBackendService
	settings         *servicesettings.Settings
	capability       *servicecapability.Service
	billing          *servicebilling.Service
	generation       *servicegeneration.GenerationService
	selection        *serviceselection.Service
	jianyingDraft    *servicejianyingdraft.Service
	mediaAssets      *servicemedia.MediaAssets
	previewStreamer  *servicemedia.FFmpegPreviewStreamer
	projectAssets    *serviceprojectasset.ProjectAssets
	promptPack       *servicepromptpack.Service
	licenseClient    *servicelicense.Client
	promptTemplates  *serviceprompttemplates.Service
	promptLibrary    *servicepromptlibrary.Service
	skillRegistry    *serviceskill.Registry
	shutdownCtx      context.Context
	shutdownCancel   context.CancelFunc
	workers          sync.WaitGroup
}

type agentRuntimeConfigInspector interface {
	InspectSessionConfig(context.Context, string, string) (agentRuntimeConfigResponse, error)
}

// SubmitAgentMessage accepts an agent message and starts a background run.
func (handler *apiHandler) SubmitAgentMessage(payload messageRequest) (messageResponse, int, error) {
	return handler.agentRuntime.SubmitAgentMessage(payload)
}

// ResolveAgentPermission resolves an in-flight ACP permission request.
func (handler *apiHandler) ResolveAgentPermission(payload agentPermissionDecisionRequest) (agentSessionStatus, int, error) {
	return handler.agentRuntime.ResolvePermission(payload)
}

// AgentSessionStatus returns status enriched with active runtime state.
func (handler *apiHandler) AgentSessionStatus(sessionID string) agentSessionStatus {
	if handler == nil || handler.agentRuntime == nil {
		return handler.agentSessions.Status(sessionID)
	}
	status := handler.agentSessions.Status(sessionID)
	status.PendingPermissions = handler.agentRuntime.PendingPermissions(sessionID)
	return status
}

// PendingAgentPermissions returns active ACP permission requests for a session.
func (handler *apiHandler) PendingAgentPermissions(sessionID string) []agentACPPermissionRequest {
	if handler == nil || handler.agentRuntime == nil {
		return nil
	}
	return handler.agentRuntime.PendingPermissions(sessionID)
}

// LoadAgentEvents replays persisted agent events.
func (handler *apiHandler) LoadAgentEvents(projectID string, sessionID string, afterSequence int64, limit int) ([]agentEvent, error) {
	return handler.workspaceState.LoadAgentEvents(projectID, sessionID, afterSequence, limit)
}

// SubscribeAgentEvents subscribes to live agent events.
func (handler *apiHandler) SubscribeAgentEvents() (<-chan agentEvent, func()) {
	return handler.events.Subscribe()
}

// NewEventID returns a random event identifier.
func (handler *apiHandler) NewEventID() string {
	return mustRandomID("event")
}

// SubscribeWorkspaceEvents subscribes to live workspace file events.
func (handler *apiHandler) SubscribeWorkspaceEvents() (<-chan serviceworkspaceevent.Event, func()) {
	return handler.workspaceEvents.Subscribe()
}

// NewWorkspaceEventID returns a random workspace event identifier.
func (handler *apiHandler) NewWorkspaceEventID() string {
	return mustRandomID("workspace-event")
}

func (handler *apiHandler) publishWorkspaceDocumentsChanged(projectID string, delta servicedocument.WorkspaceSyncDelta) {
	handler.workspaceEvents.Publish(serviceworkspaceevent.Event{
		ID:                 handler.NewWorkspaceEventID(),
		Type:               serviceworkspaceevent.DocumentsChangedEventType,
		ProjectID:          projectID,
		Message:            "工作区文件已更新。",
		CreatedAt:          timestamp.NowRFC3339Nano(),
		FullReload:         delta.FullReload,
		ChangedDocumentIDs: delta.ChangedDocumentIDs,
		RemovedDocumentIDs: delta.RemovedDocumentIDs,
		StructureChanged:   delta.StructureChanged,
	})
}

// AgentBridgeURL returns the internal agent bridge URL.
func (handler *apiHandler) AgentBridgeURL() string {
	return handler.agentBridgeURL
}

// AgentBridgeToken returns the internal agent bridge token.
func (handler *apiHandler) AgentBridgeToken() string {
	return handler.agentBridgeToken
}

// WorkspaceDir returns the resolved workspace directory.
func (handler *apiHandler) WorkspaceDir() string {
	return handler.workspaceState.Dir()
}

func (handler *apiHandler) shutdownContext() context.Context {
	if handler == nil || handler.shutdownCtx == nil {
		return context.Background()
	}
	return handler.shutdownCtx
}

func (handler *apiHandler) Close() error {
	if handler == nil {
		return nil
	}
	if handler.shutdownCancel != nil {
		handler.shutdownCancel()
	}
	handler.workers.Wait()
	if handler.workspaceState != nil {
		return handler.workspaceState.Close()
	}
	return nil
}

var (
	randomID     = serviceshared.RandomID
	mustRandomID = serviceshared.MustRandomID
)
