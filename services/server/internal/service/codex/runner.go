package codex

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/codexapp"
)

type agentRunRequest = AgentRunRequest

// ProcessConfigRequest describes the isolated Codex configuration for a run.
type ProcessConfigRequest struct{ AgentID, WorkspaceDir, ProjectID, ProjectDir, WorkingDir, PreferredModel, FixedInstructions string }

// ProcessConfig supplies the environment and supported models for a Codex profile.
type ProcessConfig struct {
	ConfigDir                  string
	Env                        map[string]string
	RestrictModelValues        bool
	AllowedModelValues         []string
	DiscoveredModelValues      []string
	NativeInstructionsInjected bool
}

// ProcessConfigProvider prepares a Codex profile.
type ProcessConfigProvider interface {
	PrepareRuntimeProcessConfig(context.Context, ProcessConfigRequest) (ProcessConfig, error)
}

// ProcessConfigProviderFunc adapts a function into a profile provider.
type ProcessConfigProviderFunc func(context.Context, ProcessConfigRequest) (ProcessConfig, error)

// PrepareRuntimeProcessConfig prepares a Codex profile.
func (fn ProcessConfigProviderFunc) PrepareRuntimeProcessConfig(ctx context.Context, r ProcessConfigRequest) (ProcessConfig, error) {
	return fn(ctx, r)
}

type resident struct {
	mu          sync.Mutex
	client      codexapp.Client
	fingerprint string
	idle        *time.Timer
	leases      int
	generation  uint64
}

// Runner executes MediaGo conversations through the bundled Codex app-server.
type Runner struct {
	workspaceDir          string
	buildPrompt           func(AgentRunRequest) string
	buildSessionRecap     SessionRecapBuilder
	processConfigProvider ProcessConfigProvider
	argvFn                func() []string
	commandFn             func() string
	command               string
	mu                    sync.Mutex
	closed                bool
	sessions              map[string]*resident
	active                map[string]*activeTurn
	ctx                   context.Context
	cancel                context.CancelFunc
	sessionFactory        func(context.Context, string, codexapp.Options) (codexapp.Client, error)
}

// NewRuntimeAgentRunnerWithDocumentMCPConfigPathAndArgv constructs the Codex runtime.
func NewRuntimeAgentRunnerWithDocumentMCPConfigPathAndArgv(command, workspaceDir, _ string, buildPrompt func(AgentRunRequest) string, commandFn func() string, argvFn func() []string) *Runner {
	ctx, cancel := context.WithCancel(context.Background())
	return &Runner{workspaceDir: workspaceDir, buildPrompt: buildPrompt, command: command, commandFn: commandFn, argvFn: argvFn, sessions: map[string]*resident{}, active: map[string]*activeTurn{}, ctx: ctx, cancel: cancel, sessionFactory: func(ctx context.Context, bin string, options codexapp.Options) (codexapp.Client, error) {
		return codexapp.StartWithOptions(ctx, bin, options)
	}}
}

// SetProcessConfigProvider installs the workspace profile provider.
func (r *Runner) SetProcessConfigProvider(p ProcessConfigProvider) { r.processConfigProvider = p }
func (r *Runner) config(ctx context.Context, request AgentRunRequest) (ProcessConfig, error) {
	if r.processConfigProvider == nil {
		return ProcessConfig{}, nil
	}
	fixed := ""
	if r.buildPrompt != nil {
		fixed = r.buildPrompt(request)
	}
	return r.processConfigProvider.PrepareRuntimeProcessConfig(ctx, ProcessConfigRequest{AgentID: "codex", WorkspaceDir: request.WorkspaceDir, ProjectID: request.ProjectID, ProjectDir: request.ProjectDir, WorkingDir: request.WorkingDir, PreferredModel: request.Model.Value, FixedInstructions: fixed})
}
func (r *Runner) binary() string {
	if r.argvFn != nil {
		if argv := r.argvFn(); len(argv) > 0 {
			return argv[0]
		}
	}
	if r.commandFn != nil {
		return r.commandFn()
	}
	if r.command != "" {
		return r.command
	}
	return "codex"
}
func (r *Runner) launch(ctx context.Context, request AgentRunRequest, config ProcessConfig) (codexapp.Client, error) {
	env := map[string]string{"CODEX_HOME": filepath.Join(r.workspaceDir, ".mediago-drama", "runtime", "agents", "codex", "account-home")}
	for k, v := range config.Env {
		env[k] = v
	}
	if err := os.MkdirAll(env["CODEX_HOME"], 0o700); err != nil {
		return nil, fmt.Errorf("creating Codex home: %w", err)
	}
	return r.sessionFactory(ctx, r.binary(), codexapp.Options{Directory: FirstNonEmpty(request.WorkingDir, request.ProjectDir, r.workspaceDir), Env: env, Stderr: logWriter{}})
}

type logWriter struct{}

func (logWriter) Write(data []byte) (int, error) {
	runtimeLog().Debug("Codex app-server stderr", "message", TruncateAgentMessage(string(data)))
	return len(data), nil
}
func (r *Runner) entry(key, fingerprint string, request AgentRunRequest, config ProcessConfig) (*resident, error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil, errors.New("Codex runtime is closed")
	}
	if e := r.sessions[key]; e != nil && e.fingerprint == fingerprint {
		e.leases++
		e.generation++
		if e.idle != nil {
			e.idle.Stop()
		}
		r.mu.Unlock()
		return e, nil
	}
	if e := r.sessions[key]; e != nil && e.leases > 0 {
		r.mu.Unlock()
		return nil, errors.New("Codex session is busy")
	}
	r.mu.Unlock()
	client, err := r.launch(r.ctx, request, config)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		client.Close()
		return nil, errors.New("Codex runtime is closed")
	}
	previous := r.sessions[key]
	if previous != nil && previous.leases > 0 {
		if previous.fingerprint != fingerprint {
			r.mu.Unlock()
			client.Close()
			return nil, errors.New("Codex session is busy")
		}
		previous.leases++
		previous.generation++
		if previous.idle != nil {
			previous.idle.Stop()
		}
		r.mu.Unlock()
		client.Close()
		return previous, nil
	}
	e := &resident{client: client, fingerprint: fingerprint, leases: 1}
	r.sessions[key] = e
	if previous != nil && previous.idle != nil {
		previous.idle.Stop()
	}
	r.mu.Unlock()
	if previous != nil {
		previous.client.Close()
	}
	return e, nil
}
func (r *Runner) release(key string, e *resident, failed bool) {
	r.mu.Lock()
	if r.sessions[key] != e {
		r.mu.Unlock()
		return
	}
	e.leases--
	if failed {
		delete(r.sessions, key)
		r.mu.Unlock()
		e.client.Close()
		return
	}
	if e.leases > 0 {
		r.mu.Unlock()
		return
	}
	e.generation++
	generation := e.generation
	e.idle = time.AfterFunc(10*time.Minute, func() {
		r.mu.Lock()
		if r.sessions[key] != e || e.leases != 0 || e.generation != generation {
			r.mu.Unlock()
			return
		}
		delete(r.sessions, key)
		r.mu.Unlock()
		e.client.Close()
	})
	r.mu.Unlock()
}

// Close cancels active work and stops all owned app-server processes.
func (r *Runner) Close() error {
	r.mu.Lock()
	r.closed = true
	r.cancel()
	sessions := r.sessions
	r.sessions = map[string]*resident{}
	for _, e := range sessions {
		if e.idle != nil {
			e.idle.Stop()
		}
	}
	r.mu.Unlock()
	for _, e := range sessions {
		e.client.Close()
	}
	return nil
}

// Run executes a turn and preserves upstream thread identity for subsequent runs.
func (r *Runner) Run(ctx context.Context, request AgentRunRequest, publish func(AgentEvent)) (result AgentRunResult, runErr error) {
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if request.WorkspaceDir == "" {
		request.WorkspaceDir = r.workspaceDir
	}
	config, err := r.config(ctx, request)
	if err != nil {
		return result, err
	}
	fixed := ""
	if r.buildPrompt != nil {
		fixed = r.buildPrompt(request)
	}
	payload, _ := json.Marshal([]any{fixed, config.ConfigDir, config.Env, request.Model.Value})
	fingerprint := fmt.Sprintf("codex-v1:%x", sha256.Sum256(payload))
	key := request.ProjectID + "/" + request.SessionID
	// A run-specific process refreshes MCP URLs/tokens even when resuming a loaded thread.
	// thread/resume rejoins an already loaded thread without applying fresh config.
	processPayload, _ := json.Marshal([]any{fingerprint, request.RunID, request.WorkingDir, request.Permission.Value, ResolveDocumentMCPServersForRun(request.WorkspaceDir, request).Servers})
	processFingerprint := fmt.Sprintf("%x", sha256.Sum256(processPayload))
	entry, err := r.entry(key, processFingerprint, request, config)
	if err != nil {
		return result, err
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	defer func() { r.release(key, entry, runErr != nil) }()
	sandbox, approval := "workspace-write", "on-request"
	switch request.Permission.Value {
	case "read-only":
		sandbox = "read-only"
	case "danger-full-access":
		sandbox = "danger-full-access"
		approval = "never"
	}
	params := map[string]any{"cwd": FirstNonEmpty(request.WorkingDir, request.ProjectDir, r.workspaceDir), "developerInstructions": fixed, "sandbox": sandbox, "approvalPolicy": approval, "config": map[string]any{"mcp_servers": ResolveDocumentMCPServersForRun(request.WorkspaceDir, request).Servers}}
	if request.Model.Value != "" {
		params["model"] = request.Model.Value
	}
	method := "thread/start"
	resumed := request.CodexThreadID != "" && request.CodexInstructionHash == fingerprint
	if resumed {
		method = "thread/resume"
		params["threadId"] = request.CodexThreadID
	}
	var thread struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := entry.client.Call(ctx, method, params, &thread); err != nil {
		// Rebuild only when the upstream thread is genuinely missing, never for auth or transient failures.
		if !resumed || !missingThread(err) {
			return result, err
		}
		resumed = false
		delete(params, "threadId")
		if err := entry.client.Call(ctx, "thread/start", params, &thread); err != nil {
			return result, err
		}
	}
	if thread.Thread.ID == "" {
		return result, errors.New("Codex returned an empty thread id")
	}
	result.CodexThreadID = thread.Thread.ID
	result.CodexInstructionHash = fingerprint
	userPrompt := BuildRuntimeUserPrompt(request)
	if !resumed {
		if recap := r.sessionRecapFor(ctx, request); recap != "" {
			userPrompt = recap + "\n\n" + userPrompt
		}
	}
	turnParams := map[string]any{"threadId": thread.Thread.ID, "input": []map[string]any{{"type": "text", "text": userPrompt}}}
	if request.Reasoning.Value != "" {
		turnParams["effort"] = request.Reasoning.Value
	}
	active := newActiveTurn(entry.client, request, thread.Thread.ID, publish)
	r.mu.Lock()
	r.active[key] = active
	r.mu.Unlock()
	defer func() { active.close(); r.mu.Lock(); delete(r.active, key); r.mu.Unlock() }()
	var turn struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := entry.client.Call(ctx, "turn/start", turnParams, &turn); err != nil {
		return result, err
	}
	if turn.Turn.ID == "" {
		return result, errors.New("Codex returned an empty turn id")
	}
	active.turnID = turn.Turn.ID
	interruptDone := make(chan struct{})
	stopCancel := context.AfterFunc(ctx, func() {
		defer close(interruptDone)
		interruptCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = entry.client.Call(interruptCtx, "turn/interrupt", map[string]string{"threadId": thread.Thread.ID, "turnId": turn.Turn.ID}, nil)
	})
	defer func() {
		if !stopCancel() {
			<-interruptDone
		}
	}()
	for {
		message, err := entry.client.Next(ctx)
		if err != nil {
			return result, err
		}
		done, err := active.handle(ctx, message)
		if err != nil {
			return result, err
		}
		if done {
			response := ParseRuntimeFinalResponse(active.finalText, request)
			result.Message = response.Message
			result.DocumentProposal = response.ProposedDocument
			result.A2UI = response.A2UI
			result.MessageItemID = active.finalItemID
			result.StreamedMessage = active.streamed
			return result, nil
		}
	}
}
func missingThread(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "thread") && (strings.Contains(s, "not found") || strings.Contains(s, "does not exist"))
}

// IsAuthenticationRequiredError recognizes authentication failures without exposing credentials.
func IsAuthenticationRequiredError(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "not authenticated") || strings.Contains(s, "authentication required") || strings.Contains(s, "not logged in") || strings.Contains(s, "unauthorized")
}

// InspectSessionConfig returns available models and explicit Codex permission controls.
func (r *Runner) InspectSessionConfig(ctx context.Context, projectID, projectDir string) (AgentRuntimeConfigResponse, error) {
	request := AgentRunRequest{WorkspaceDir: r.workspaceDir, ProjectID: projectID, ProjectDir: projectDir, WorkingDir: projectDir}
	config, err := r.config(ctx, request)
	if err != nil {
		return AgentRuntimeConfigResponse{}, err
	}
	client, err := r.launch(ctx, request, config)
	if err != nil {
		return AgentRuntimeConfigResponse{}, err
	}
	defer client.Close()
	var models struct {
		Data []struct {
			Model, DisplayName, Description, DefaultReasoningEffort string
			IsDefault                                               bool
			SupportedReasoningEfforts                               []struct{ ReasoningEffort, Description string }
		} `json:"data"`
		NextCursor *string `json:"nextCursor"`
	}
	options := []AgentRuntimeSelectOption{}
	selected := ""
	selectedEffort := ""
	efforts := []AgentRuntimeSelectOption{}
	effortSeen := map[string]bool{}
	cursor := ""
	for {
		params := map[string]any{"limit": 100}
		if cursor != "" {
			params["cursor"] = cursor
		}
		if err := client.Call(ctx, "model/list", params, &models); err != nil {
			return AgentRuntimeConfigResponse{}, err
		}
		for _, model := range models.Data {
			if config.RestrictModelValues && !contains(config.AllowedModelValues, model.Model) {
				continue
			}
			options = append(options, AgentRuntimeSelectOption{Value: model.Model, Name: FirstNonEmpty(model.DisplayName, model.Model), Description: model.Description})
			if model.IsDefault {
				selected = model.Model
				selectedEffort = model.DefaultReasoningEffort
			}
			for _, effort := range model.SupportedReasoningEfforts {
				if !effortSeen[effort.ReasoningEffort] {
					effortSeen[effort.ReasoningEffort] = true
					efforts = append(efforts, AgentRuntimeSelectOption{Value: effort.ReasoningEffort, Name: effort.ReasoningEffort, Description: effort.Description})
				}
			}
		}
		if models.NextCursor == nil || *models.NextCursor == "" || *models.NextCursor == cursor {
			break
		}
		cursor = *models.NextCursor
	}
	for _, model := range config.DiscoveredModelValues {
		exists := false
		for _, option := range options {
			if option.Value == model {
				exists = true
			}
		}
		if !exists {
			options = append(options, AgentRuntimeSelectOption{Value: model, Name: model})
		}
	}
	if selected == "" && len(options) > 0 {
		selected = options[0].Value
	}
	response := AgentRuntimeConfigResponse{Model: &AgentRuntimeSelectConfig{ConfigID: "model", Name: "模型", Source: "codex", CurrentValue: selected, Options: options}, Permission: &AgentRuntimeSelectConfig{ConfigID: "sandbox", Name: "权限", Source: "codex", CurrentValue: "workspace-write", Options: []AgentRuntimeSelectOption{{Value: "read-only", Name: "只读"}, {Value: "workspace-write", Name: "项目写入（需审批）"}, {Value: "danger-full-access", Name: "完全访问"}}}}
	if len(efforts) > 0 {
		response.Reasoning = &AgentRuntimeSelectConfig{ConfigID: "effort", Name: "推理强度", Source: "codex", CurrentValue: selectedEffort, Options: efforts}
	}
	return response, nil
}
func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

var _ io.Writer = logWriter{}
