package acp

import (
	"context"
	"fmt"
	"sync"

	acp "github.com/coder/acp-go-sdk"
)

// acpClientRouter is the process-scoped ACP callback endpoint. A resident ACP
// connection keeps this router for its whole lifetime while each MediaGo run
// binds a fresh, run-scoped acpClient.
type acpClientRouter struct {
	mu     sync.RWMutex
	active *acpClient
}

func (router *acpClientRouter) bind(client *acpClient) error {
	if router == nil || client == nil {
		return fmt.Errorf("binding ACP client: missing router or client")
	}
	router.mu.Lock()
	defer router.mu.Unlock()
	if router.active != nil && router.active != client {
		return fmt.Errorf("binding ACP client: another run is still active")
	}
	router.active = client
	return nil
}

func (router *acpClientRouter) unbind(client *acpClient) {
	if router == nil || client == nil {
		return
	}
	router.mu.Lock()
	defer router.mu.Unlock()
	if router.active == client {
		router.active = nil
	}
}

// lockCurrent keeps the run binding stable for the whole delegated callback.
// unbind takes the write lock, so it also acts as a drain barrier for callbacks
// and process log writes that already observed the current run.
func (router *acpClientRouter) lockCurrent() (*acpClient, func()) {
	if router == nil {
		return nil, func() {}
	}
	router.mu.RLock()
	return router.active, router.mu.RUnlock
}

func (router *acpClientRouter) logStdoutLine(line string) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		client.rawLog.logStdoutLine(line)
	}
}

func (router *acpClientRouter) noActiveRunError(operation string) error {
	return fmt.Errorf("%s: no active MediaGo ACP run", operation)
}

func (router *acpClientRouter) ReadTextFile(ctx context.Context, request acp.ReadTextFileRequest) (acp.ReadTextFileResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.ReadTextFile(ctx, request)
	}
	return acp.ReadTextFileResponse{}, router.noActiveRunError("reading text file")
}

func (router *acpClientRouter) WriteTextFile(ctx context.Context, request acp.WriteTextFileRequest) (acp.WriteTextFileResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.WriteTextFile(ctx, request)
	}
	return acp.WriteTextFileResponse{}, router.noActiveRunError("writing text file")
}

func (router *acpClientRouter) RequestPermission(ctx context.Context, request acp.RequestPermissionRequest) (acp.RequestPermissionResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.RequestPermission(ctx, request)
	}
	// Permission requests arriving after a run was detached must not remain
	// pending or accidentally bind to the next turn.
	return acp.RequestPermissionResponse{
		Outcome: acp.RequestPermissionOutcome{
			Cancelled: &acp.RequestPermissionOutcomeCancelled{},
		},
	}, nil
}

func (router *acpClientRouter) SessionUpdate(ctx context.Context, notification acp.SessionNotification) error {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.SessionUpdate(ctx, notification)
	}
	acpLog().Debug(
		"acp session update ignored without active run",
		"acp_session_id", notification.SessionId,
		"update", sessionUpdateKind(notification.Update),
	)
	return nil
}

func (router *acpClientRouter) CreateTerminal(ctx context.Context, request acp.CreateTerminalRequest) (acp.CreateTerminalResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.CreateTerminal(ctx, request)
	}
	return acp.CreateTerminalResponse{}, router.noActiveRunError("creating terminal")
}

func (router *acpClientRouter) KillTerminal(ctx context.Context, request acp.KillTerminalRequest) (acp.KillTerminalResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.KillTerminal(ctx, request)
	}
	return acp.KillTerminalResponse{}, router.noActiveRunError("killing terminal")
}

func (router *acpClientRouter) TerminalOutput(ctx context.Context, request acp.TerminalOutputRequest) (acp.TerminalOutputResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.TerminalOutput(ctx, request)
	}
	return acp.TerminalOutputResponse{}, router.noActiveRunError("reading terminal output")
}

func (router *acpClientRouter) ReleaseTerminal(ctx context.Context, request acp.ReleaseTerminalRequest) (acp.ReleaseTerminalResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.ReleaseTerminal(ctx, request)
	}
	return acp.ReleaseTerminalResponse{}, router.noActiveRunError("releasing terminal")
}

func (router *acpClientRouter) WaitForTerminalExit(ctx context.Context, request acp.WaitForTerminalExitRequest) (acp.WaitForTerminalExitResponse, error) {
	client, unlock := router.lockCurrent()
	defer unlock()
	if client != nil {
		return client.WaitForTerminalExit(ctx, request)
	}
	return acp.WaitForTerminalExitResponse{}, router.noActiveRunError("waiting for terminal exit")
}

var _ acp.Client = (*acpClientRouter)(nil)
