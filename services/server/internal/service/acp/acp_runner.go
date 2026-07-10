package acp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

const mediaGoDramaMCPServerName = MediaGoDramaMCPServerName

type documentMCPServerResolution = DocumentMCPServerResolution
type agentRuntimeConfigResponse = AgentRuntimeConfigResponse
type agentRunRequest = AgentRunRequest
type agentRunResult = AgentRunResult
type agentDocumentContext = AgentDocumentContext
type agentACPConfigSelection = AgentACPConfigSelection
type agentACPEvent = AgentACPEvent

type acpSessionConfigurator interface {
	SetSessionConfigOption(context.Context, acp.SetSessionConfigOptionRequest) (acp.SetSessionConfigOptionResponse, error)
	SetSessionMode(context.Context, acp.SetSessionModeRequest) (acp.SetSessionModeResponse, error)
}

type acpAgentRunner struct {
	commandFn             func() string
	argvFn                func() []string
	workspaceDir          string
	documentMCPConfigPath string
	buildPrompt           func(AgentRunRequest) string
	buildSessionRecap     SessionRecapBuilder
	processConfigProvider ProcessConfigProvider
	activeClients         sync.Map
}

type permissionDecision struct {
	OptionID  acp.PermissionOptionId
	Cancelled bool
}

type acpClient struct {
	publish             func(agentEvent)
	workspaceDir        string
	sessionID           string
	runID               string
	acpSessionID        string
	rawLog              *acpRawLogger
	mu                  sync.Mutex
	acceptUpdate        bool
	message             strings.Builder
	streamedMessage     bool
	runtimeErrorMessage string
	promptStartedAt     time.Time
	firstUpdateLogged   bool
	updateCount         int
	activityUpdateCount int
	messageChunkCount   int
	thoughtChunkCount   int
	toolCallCount       int
	toolCallStarts      map[string]time.Time
	pendingPermissions  sync.Map
	pendingRequests     sync.Map
	permissionTimeout   time.Duration
	thoughtMu           sync.Mutex
	thoughtBuf          strings.Builder
	thoughtTimer        *time.Timer
}

// NewACPAgentRunner creates an ACP-backed agent runner.
func NewACPAgentRunner(command string, workspaceDir string, buildPrompt func(AgentRunRequest) string, commandFn func() string) *acpAgentRunner {
	return NewACPAgentRunnerWithDocumentMCPConfigPath(command, workspaceDir, "", buildPrompt, commandFn)
}

// NewACPAgentRunnerWithDocumentMCPConfigPath creates an ACP-backed agent runner.
func NewACPAgentRunnerWithDocumentMCPConfigPath(
	command string,
	workspaceDir string,
	documentMCPConfigPath string,
	buildPrompt func(AgentRunRequest) string,
	commandFn func() string,
) *acpAgentRunner {
	return NewACPAgentRunnerWithDocumentMCPConfigPathAndArgv(
		command,
		workspaceDir,
		documentMCPConfigPath,
		buildPrompt,
		commandFn,
		nil,
	)
}

// NewACPAgentRunnerWithDocumentMCPConfigPathAndArgv creates an ACP-backed agent runner.
func NewACPAgentRunnerWithDocumentMCPConfigPathAndArgv(
	command string,
	workspaceDir string,
	documentMCPConfigPath string,
	buildPrompt func(AgentRunRequest) string,
	commandFn func() string,
	argvFn func() []string,
) *acpAgentRunner {
	if command == "" {
		command = "codex-acp"
	}
	if commandFn == nil {
		commandFn = func() string {
			return command
		}
	}
	if workspaceDir == "" {
		if cwd, err := os.Getwd(); err == nil {
			workspaceDir = cwd
		}
	}

	return &acpAgentRunner{
		commandFn:             commandFn,
		argvFn:                argvFn,
		workspaceDir:          workspaceDir,
		documentMCPConfigPath: strings.TrimSpace(documentMCPConfigPath),
		buildPrompt:           buildPrompt,
	}
}

// ProcessConfigRequest describes one ACP child process launch.
type ProcessConfigRequest struct {
	AgentID        string
	WorkspaceDir   string
	ProjectID      string
	ProjectDir     string
	WorkingDir     string
	PreferredModel string
}

// ProcessConfig contains extra environment for one ACP child process.
type ProcessConfig struct {
	ConfigDir             string
	Env                   map[string]string
	ProfileCount          int
	DefaultProfileID      string
	RestrictModelValues   bool
	AllowedModelValues    []string
	AllowedModelProviders []string
	DiscoveredModelValues []string
}

// ProcessConfigProvider prepares extra config for one ACP child process.
type ProcessConfigProvider interface {
	PrepareACPProcessConfig(context.Context, ProcessConfigRequest) (ProcessConfig, error)
}

// ProcessConfigProviderFunc adapts a function into a ProcessConfigProvider.
type ProcessConfigProviderFunc func(context.Context, ProcessConfigRequest) (ProcessConfig, error)

// PrepareACPProcessConfig prepares extra config for one ACP child process.
func (fn ProcessConfigProviderFunc) PrepareACPProcessConfig(ctx context.Context, request ProcessConfigRequest) (ProcessConfig, error) {
	return fn(ctx, request)
}

// SetProcessConfigProvider sets the optional ACP child process config provider.
func (runner *acpAgentRunner) SetProcessConfigProvider(provider ProcessConfigProvider) {
	if runner == nil {
		return
	}
	runner.processConfigProvider = provider
}

// InspectSessionConfig probes ACP runtime config for a project.
func (runner *acpAgentRunner) InspectSessionConfig(ctx context.Context, projectID string, projectDir string) (agentRuntimeConfigResponse, error) {
	command, args := runner.activeCommandArgv()
	workspaceDir := runner.absoluteWorkspaceDir()
	request := agentRunRequest{
		ProjectID:    projectID,
		WorkspaceDir: workspaceDir,
		ProjectDir:   projectDir,
		WorkingDir:   projectWorkingDir(projectID, projectDir),
	}
	runDir := runner.absoluteRunDir(request)
	if runDir != "." {
		if err := os.MkdirAll(runDir, 0o755); err != nil {
			return agentRuntimeConfigResponse{}, fmt.Errorf("creating ACP run directory: %w", err)
		}
	}
	logArgs := []any{
		"command", command,
		"arg_count", len(args),
		"workspace", workspaceDir,
		"cwd", runDir,
		"project_id", diagnosticProjectID(projectID),
	}
	acpLog().Debug("acp config probe starting", logArgs...)

	processConfig, err := runner.prepareProcessConfig(ctx, command, args, request)
	if err != nil {
		return agentRuntimeConfigResponse{}, err
	}
	cmd := exec.CommandContext(ctx, command, args...)
	if runDir != "" {
		cmd.Dir = runDir
	}
	cmd.Env = mergedProcessEnv(processConfig)
	cmd.Stderr = io.Discard

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return agentRuntimeConfigResponse{}, fmt.Errorf("opening ACP stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return agentRuntimeConfigResponse{}, fmt.Errorf("opening ACP stdout: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return agentRuntimeConfigResponse{}, fmt.Errorf("starting ACP agent %q: %w", command, err)
	}
	startedAt := time.Now()
	pid := 0
	if cmd.Process != nil {
		pid = cmd.Process.Pid
	}
	defer func() {
		go cleanupACPProcess(cmd, stdin, stdout, logArgs, pid, startedAt)
	}()

	client := &acpClient{
		publish:      func(agentEvent) {},
		workspaceDir: workspaceDir,
	}
	conn := acp.NewClientSideConnection(client, stdin, stdout)
	conn.SetLogger(acpLog())

	if _, err := conn.Initialize(ctx, acp.InitializeRequest{
		ProtocolVersion: acp.ProtocolVersionNumber,
		ClientInfo: &acp.Implementation{
			Name:    "MediaGo Drama",
			Version: "0.0.0",
		},
		ClientCapabilities: acp.ClientCapabilities{
			Fs: acp.FileSystemCapabilities{
				ReadTextFile:  true,
				WriteTextFile: true,
			},
			Terminal: false,
		},
	}); err != nil {
		return agentRuntimeConfigResponse{}, fmt.Errorf("initializing ACP agent: %w", err)
	}

	request.DocumentMCPConfigPath = runner.documentMCPConfigPath
	mcpServers := resolveDocumentMCPServersForRun(workspaceDir, request).Servers
	if mcpServers == nil {
		mcpServers = []acp.McpServer{}
	}
	session, err := conn.NewSession(ctx, acp.NewSessionRequest{
		Cwd:        runDir,
		McpServers: mcpServers,
	})
	if err != nil {
		return agentRuntimeConfigResponse{}, fmt.Errorf("creating ACP config probe session: %w", err)
	}
	config := agentRuntimeConfigFromACPSession(session, agentRuntimeModelFilter{
		Restrict:         processConfig.RestrictModelValues,
		AllowedValues:    processConfig.AllowedModelValues,
		AllowedProviders: processConfig.AllowedModelProviders,
		DiscoveredValues: processConfig.DiscoveredModelValues,
	})
	acpLog().Debug(
		"acp config probe completed",
		append(logArgs,
			"acp_session_id", session.SessionId,
			"has_model", config.Model != nil,
			"has_reasoning", config.Reasoning != nil,
			"has_permission", config.Permission != nil,
		)...,
	)
	return config, nil
}

func (runner *acpAgentRunner) activeCommandArgv() (string, []string) {
	if runner != nil && runner.argvFn != nil {
		argv := runner.argvFn()
		if len(argv) > 0 && strings.TrimSpace(argv[0]) != "" {
			command := strings.TrimSpace(argv[0])
			args := make([]string, 0, len(argv)-1)
			args = append(args, argv[1:]...)
			return command, args
		}
	}

	var commandFn func() string
	if runner != nil {
		commandFn = runner.commandFn
	}
	if commandFn == nil {
		commandFn = func() string {
			return "codex-acp"
		}
	}
	return SplitCommand(commandFn())
}

func (runner *acpAgentRunner) prepareProcessConfig(ctx context.Context, command string, args []string, request agentRunRequest) (ProcessConfig, error) {
	agentID := acpAgentIDForCommand(command, args)
	if runner == nil || runner.processConfigProvider == nil || agentID == "" {
		return ProcessConfig{}, nil
	}
	processConfig, err := runner.processConfigProvider.PrepareACPProcessConfig(ctx, ProcessConfigRequest{
		AgentID:        agentID,
		WorkspaceDir:   strings.TrimSpace(request.WorkspaceDir),
		ProjectID:      strings.TrimSpace(request.ProjectID),
		ProjectDir:     strings.TrimSpace(request.ProjectDir),
		WorkingDir:     strings.TrimSpace(request.WorkingDir),
		PreferredModel: strings.TrimSpace(request.Model.Value),
	})
	if err != nil {
		return ProcessConfig{}, fmt.Errorf("preparing %s config: %w", agentID, err)
	}
	if strings.TrimSpace(processConfig.ConfigDir) != "" {
		processConfig.Env = cloneProcessConfigEnv(processConfig.Env)
		processConfig.Env["OPENCODE_CONFIG_DIR"] = strings.TrimSpace(processConfig.ConfigDir)
		if agentID == "codex" {
			delete(processConfig.Env, "OPENCODE_CONFIG_DIR")
		}
		acpLog().Info(
			"acp process config prepared",
			"agent_id", agentID,
			"config_dir", strings.TrimSpace(processConfig.ConfigDir),
			"profile_count", processConfig.ProfileCount,
			"default_profile_id", strings.TrimSpace(processConfig.DefaultProfileID),
			"env_count", len(processConfig.Env),
		)
	}
	return processConfig, nil
}

func cloneProcessConfigEnv(source map[string]string) map[string]string {
	env := make(map[string]string, len(source)+1)
	for key, value := range source {
		env[key] = value
	}
	return env
}

func mergedProcessEnv(processConfig ProcessConfig) []string {
	if len(processConfig.Env) == 0 {
		return nil
	}
	env := map[string]string{}
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok {
			env[key] = value
		}
	}
	for key, value := range processConfig.Env {
		key = strings.TrimSpace(key)
		if key != "" {
			env[key] = value
		}
	}
	result := make([]string, 0, len(env))
	for key, value := range env {
		result = append(result, key+"="+value)
	}
	sort.Strings(result)
	return result
}

func isOpenCodeACPCommand(command string, args []string) bool {
	bin := strings.ToLower(filepath.Base(strings.TrimSpace(command)))
	if bin != "opencode" && bin != "opencode.exe" {
		return false
	}
	return len(args) > 0 && strings.TrimSpace(args[0]) == "acp"
}

func isCodexACPCommand(command string, args []string) bool {
	_ = args
	bin := strings.ToLower(filepath.Base(strings.TrimSpace(command)))
	return bin == "codex-acp" || bin == "codex-acp.exe"
}

func acpAgentIDForCommand(command string, args []string) string {
	switch {
	case isOpenCodeACPCommand(command, args):
		return "opencode"
	case isCodexACPCommand(command, args):
		return "codex"
	default:
		return ""
	}
}

func applyACPSessionSelections(ctx context.Context, conn acpSessionConfigurator, sessionID acp.SessionId, request agentRunRequest, logArgs []any) error {
	if err := applyACPConfigSelection(ctx, conn, sessionID, request.Model, "model", logArgs); err != nil {
		return err
	}
	if shouldApplyACPReasoningSelection(request) {
		if err := applyACPConfigSelection(ctx, conn, sessionID, request.Reasoning, "reasoning", logArgs); err != nil {
			if isACPInvalidParamsError(err) {
				acpLog().Warn("acp reasoning config ignored", append(logArgs, "acp_session_id", sessionID, "error", err)...)
			} else {
				return err
			}
		}
	}
	if err := applyACPConfigSelection(ctx, conn, sessionID, request.Permission, "permission", logArgs); err != nil {
		return err
	}
	return nil
}

func shouldApplyACPReasoningSelection(request agentRunRequest) bool {
	if strings.TrimSpace(request.Reasoning.Value) == "" {
		return false
	}
	provider, _, ok := strings.Cut(strings.TrimSpace(request.Model.Value), "/")
	if !ok {
		return true
	}
	normalizedProvider := strings.ToLower(strings.TrimSpace(provider))
	if normalizedProvider == "mediago" || normalizedProvider == "minimax-cn" {
		return agentRuntimeModelSupportsOpenCodeThinking(request.Model.Value)
	}
	switch normalizedProvider {
	case "deepseek", "dmx", "dmxapi", "openrouter":
		return false
	default:
		return true
	}
}

func applyACPConfigSelection(ctx context.Context, conn acpSessionConfigurator, sessionID acp.SessionId, selection agentACPConfigSelection, label string, logArgs []any) error {
	value := strings.TrimSpace(selection.Value)
	if value == "" {
		return nil
	}
	source := strings.TrimSpace(selection.Source)
	configID := strings.TrimSpace(selection.ConfigID)
	if source == AgentRuntimeConfigSourceMode || (label == "permission" && configID == "") {
		if _, err := conn.SetSessionMode(ctx, acp.SetSessionModeRequest{
			SessionId: sessionID,
			ModeId:    acp.SessionModeId(value),
		}); err != nil {
			return fmt.Errorf("setting ACP %s: %w", label, err)
		}
		acpLog().Debug(
			"acp session mode selected",
			append(logArgs, "acp_session_id", sessionID, "mode", value)...,
		)
		return nil
	}
	if configID == "" {
		return fmt.Errorf("setting ACP %s: missing config id", label)
	}
	if _, err := conn.SetSessionConfigOption(ctx, acp.SetSessionConfigOptionRequest{
		ValueId: &acp.SetSessionConfigOptionValueId{
			SessionId: sessionID,
			ConfigId:  acp.SessionConfigId(configID),
			Value:     acp.SessionConfigValueId(value),
		},
	}); err != nil {
		return fmt.Errorf("setting ACP %s: %w", label, err)
	}
	acpLog().Debug(
		"acp session config selected",
		append(logArgs, "acp_session_id", sessionID, "config_id", configID, "value", value)...,
	)
	return nil
}

func isACPInvalidParamsError(err error) bool {
	var requestErr *acp.RequestError
	return errors.As(err, &requestErr) && requestErr.Code == -32602
}

func (runner *acpAgentRunner) absoluteWorkspaceDir() string {
	if runner.workspaceDir == "" {
		return "."
	}
	absolute, err := filepath.Abs(runner.workspaceDir)
	if err != nil {
		return runner.workspaceDir
	}
	return absolute
}

func (runner *acpAgentRunner) absoluteRunDir(request agentRunRequest) string {
	runDir := strings.TrimSpace(request.WorkingDir)
	if runDir == "" {
		runDir = strings.TrimSpace(request.ProjectDir)
	}
	if runDir == "" {
		runDir = strings.TrimSpace(request.WorkspaceDir)
	}
	if runDir == "" {
		runDir = runner.workspaceDir
	}
	if runDir == "" {
		return "."
	}
	absolute, err := filepath.Abs(runDir)
	if err != nil {
		return runDir
	}
	return filepath.Clean(absolute)
}

func projectWorkingDir(projectID string, projectDir string) string {
	projectDir = strings.TrimSpace(projectDir)
	if projectDir == "" || strings.TrimSpace(projectID) == "" {
		return projectDir
	}
	return filepath.Join(projectDir, "work")
}

func documentMCPServers(workspaceDir string, projectID string) []acp.McpServer {
	return DocumentMCPServers(workspaceDir, projectID)
}

func documentMCPServersForRun(workspaceDir string, request agentRunRequest) []acp.McpServer {
	return DocumentMCPServersForRun(workspaceDir, request)
}

func resolveDocumentMCPServersForRun(workspaceDir string, request agentRunRequest) documentMCPServerResolution {
	return ResolveDocumentMCPServersForRun(workspaceDir, request)
}

func documentMCPDisabledActivityMessage(resolution documentMCPServerResolution) string {
	return DocumentMCPDisabledActivityMessage(resolution)
}

func mediaGoDramaMCPToolPrefix() string {
	return MediaGoDramaMCPToolPrefix()
}

func mediaGoDramaMCPToolName(toolName string) string {
	return MediaGoDramaMCPToolName(toolName)
}

func diagnosticProjectID(projectID string) string {
	return DiagnosticProjectID(projectID)
}
