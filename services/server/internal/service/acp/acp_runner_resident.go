package acp

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

const (
	residentACPProcessFingerprintVersion = "resident-process-v1"
	defaultResidentACPIdleTimeout        = 10 * time.Minute
	residentACPCancelGracePeriod         = 500 * time.Millisecond
)

type acpRunnerConnection interface {
	acpSessionConfigurator
	Initialize(context.Context, acp.InitializeRequest) (acp.InitializeResponse, error)
	LoadSession(context.Context, acp.LoadSessionRequest) (acp.LoadSessionResponse, error)
	NewSession(context.Context, acp.NewSessionRequest) (acp.NewSessionResponse, error)
	Prompt(context.Context, acp.PromptRequest) (acp.PromptResponse, error)
	ResumeSession(context.Context, acp.ResumeSessionRequest) (acp.ResumeSessionResponse, error)
	Done() <-chan struct{}
}

type acpPromptConnection interface {
	Prompt(context.Context, acp.PromptRequest) (acp.PromptResponse, error)
}

type acpResidentProcessSpec struct {
	command         string
	args            []string
	dir             string
	workspaceDir    string
	env             []string
	configDir       string
	instructionHash string
	logArgs         []any
	fingerprint     string
}

type acpResidentProcessFactory func(context.Context, acpResidentProcessSpec, *acpClientRouter) (*acpResidentProcess, error)

type acpResidentProcess struct {
	connection         acpRunnerConnection
	router             *acpClientRouter
	initializeResponse acp.InitializeResponse
	fingerprint        string
	closeOnce          sync.Once
	closeFn            func()
}

func (process *acpResidentProcess) Close() {
	if process == nil {
		return
	}
	process.closeOnce.Do(func() {
		if process.closeFn != nil {
			process.closeFn()
		}
	})
}

type acpResidentSessionEntry struct {
	runMu     sync.Mutex
	processMu sync.Mutex
	process   *acpResidentProcess
	leases    int
	idleTimer *time.Timer
}

func (entry *acpResidentSessionEntry) currentProcess() *acpResidentProcess {
	if entry == nil {
		return nil
	}
	entry.processMu.Lock()
	defer entry.processMu.Unlock()
	return entry.process
}

func (entry *acpResidentSessionEntry) replaceProcess(process *acpResidentProcess) *acpResidentProcess {
	if entry == nil {
		return nil
	}
	entry.processMu.Lock()
	defer entry.processMu.Unlock()
	previous := entry.process
	entry.process = process
	return previous
}

func (entry *acpResidentSessionEntry) detachProcess(process *acpResidentProcess) bool {
	if entry == nil || process == nil {
		return false
	}
	entry.processMu.Lock()
	defer entry.processMu.Unlock()
	if entry.process != process {
		return false
	}
	entry.process = nil
	return true
}

func (entry *acpResidentSessionEntry) takeProcess() *acpResidentProcess {
	if entry == nil {
		return nil
	}
	entry.processMu.Lock()
	defer entry.processMu.Unlock()
	process := entry.process
	entry.process = nil
	return process
}

type acpResidentLease struct {
	runner    *acpAgentRunner
	sessionID string
	entry     *acpResidentSessionEntry
	released  bool
}

func (runner *acpAgentRunner) acquireResidentLease(sessionID string) (*acpResidentLease, error) {
	if runner == nil {
		return nil, fmt.Errorf("ACP runner is unavailable")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("missing MediaGo session id")
	}

	runner.residentMu.Lock()
	if runner.residentClosed {
		runner.residentMu.Unlock()
		return nil, fmt.Errorf("ACP runner is closed")
	}
	if runner.residentSessions == nil {
		runner.residentSessions = map[string]*acpResidentSessionEntry{}
	}
	entry := runner.residentSessions[sessionID]
	if entry == nil {
		entry = &acpResidentSessionEntry{}
		runner.residentSessions[sessionID] = entry
	}
	entry.leases++
	if entry.idleTimer != nil {
		entry.idleTimer.Stop()
		entry.idleTimer = nil
	}
	runner.residentMu.Unlock()

	entry.runMu.Lock()
	runner.residentMu.Lock()
	closed := runner.residentClosed
	runner.residentMu.Unlock()
	if closed {
		entry.runMu.Unlock()
		runner.finishResidentLease(sessionID, entry)
		return nil, fmt.Errorf("ACP runner is closed")
	}
	return &acpResidentLease{runner: runner, sessionID: sessionID, entry: entry}, nil
}

func (lease *acpResidentLease) process() *acpResidentProcess {
	if lease == nil || lease.entry == nil {
		return nil
	}
	return lease.entry.currentProcess()
}

func (lease *acpResidentLease) setProcess(process *acpResidentProcess) error {
	if lease == nil || lease.runner == nil || lease.entry == nil || process == nil {
		if process != nil {
			process.Close()
		}
		return fmt.Errorf("registering ACP resident process: missing lease or process")
	}

	// Installing the process and checking registry ownership must be atomic with
	// Close. Otherwise shutdown can clear the registry while Initialize is in
	// flight, after which the run could install an unreachable orphan process.
	lease.runner.residentMu.Lock()
	accepted := !lease.runner.residentClosed &&
		lease.runner.residentSessions[lease.sessionID] == lease.entry
	var previous *acpResidentProcess
	if accepted {
		previous = lease.entry.replaceProcess(process)
	}
	lease.runner.residentMu.Unlock()

	if !accepted {
		process.Close()
		return fmt.Errorf("registering ACP resident process: ACP runner is closed")
	}
	if previous != nil && previous != process {
		previous.Close()
	}
	lease.runner.watchResidentProcess(lease.entry, process)
	return nil
}

func (lease *acpResidentLease) invalidate(process *acpResidentProcess) {
	if lease == nil || lease.entry == nil || process == nil {
		return
	}
	if lease.entry.detachProcess(process) {
		process.Close()
	}
}

func (lease *acpResidentLease) release() {
	if lease == nil || lease.released || lease.entry == nil {
		return
	}
	lease.released = true
	lease.entry.runMu.Unlock()
	lease.runner.finishResidentLease(lease.sessionID, lease.entry)
}

func (runner *acpAgentRunner) finishResidentLease(sessionID string, entry *acpResidentSessionEntry) {
	if runner == nil || entry == nil {
		return
	}
	runner.residentMu.Lock()
	defer runner.residentMu.Unlock()
	if entry.leases > 0 {
		entry.leases--
	}
	if runner.residentClosed || entry.leases != 0 || runner.residentSessions[sessionID] != entry {
		return
	}
	if entry.currentProcess() == nil {
		delete(runner.residentSessions, sessionID)
		return
	}
	timeout := runner.residentIdleTimeout
	if timeout <= 0 {
		timeout = defaultResidentACPIdleTimeout
	}
	entry.idleTimer = time.AfterFunc(timeout, func() {
		runner.evictIdleResidentSession(sessionID, entry)
	})
}

func (runner *acpAgentRunner) evictIdleResidentSession(sessionID string, entry *acpResidentSessionEntry) {
	if runner == nil || entry == nil {
		return
	}
	runner.residentMu.Lock()
	if runner.residentClosed || entry.leases != 0 || runner.residentSessions[sessionID] != entry {
		runner.residentMu.Unlock()
		return
	}
	delete(runner.residentSessions, sessionID)
	entry.idleTimer = nil
	process := entry.takeProcess()
	runner.residentMu.Unlock()
	if process != nil {
		acpLog().Info("acp resident process evicted", "session_id", sessionID)
		process.Close()
	}
}

func (runner *acpAgentRunner) watchResidentProcess(entry *acpResidentSessionEntry, process *acpResidentProcess) {
	if runner == nil || entry == nil || process == nil || process.connection == nil || process.connection.Done() == nil {
		return
	}
	go func() {
		<-process.connection.Done()
		if entry.detachProcess(process) {
			acpLog().Info("acp resident process disconnected")
			process.Close()
		}
	}()
}

// Close terminates every resident ACP process. It is safe to call concurrently
// and more than once.
func (runner *acpAgentRunner) Close() error {
	if runner == nil {
		return nil
	}
	runner.residentMu.Lock()
	if runner.residentCloseDone == nil {
		runner.residentCloseDone = make(chan struct{})
	}
	done := runner.residentCloseDone
	if runner.residentClosed {
		runner.residentMu.Unlock()
		<-done
		return nil
	}
	runner.residentClosed = true
	entries := make([]*acpResidentSessionEntry, 0, len(runner.residentSessions))
	for _, entry := range runner.residentSessions {
		if entry.idleTimer != nil {
			entry.idleTimer.Stop()
			entry.idleTimer = nil
		}
		entries = append(entries, entry)
	}
	runner.residentSessions = map[string]*acpResidentSessionEntry{}
	runner.residentMu.Unlock()

	var group sync.WaitGroup
	for _, entry := range entries {
		if process := entry.takeProcess(); process != nil {
			group.Add(1)
			go func() {
				defer group.Done()
				process.Close()
			}()
		}
	}
	group.Wait()
	close(done)
	return nil
}

func residentACPProcessFingerprint(spec acpResidentProcessSpec) string {
	env := append([]string(nil), spec.env...)
	sort.Strings(env)
	payload := struct {
		Version         string   `json:"version"`
		Command         string   `json:"command"`
		Args            []string `json:"args"`
		Dir             string   `json:"dir"`
		WorkspaceDir    string   `json:"workspaceDir"`
		Env             []string `json:"env"`
		ConfigDir       string   `json:"configDir"`
		InstructionHash string   `json:"instructionHash"`
	}{
		Version:         residentACPProcessFingerprintVersion,
		Command:         strings.TrimSpace(spec.command),
		Args:            append([]string(nil), spec.args...),
		Dir:             strings.TrimSpace(spec.dir),
		WorkspaceDir:    strings.TrimSpace(spec.workspaceDir),
		Env:             env,
		ConfigDir:       strings.TrimSpace(spec.configDir),
		InstructionHash: strings.TrimSpace(spec.instructionHash),
	}
	data, _ := json.Marshal(payload)
	sum := sha256.Sum256(data)
	return residentACPProcessFingerprintVersion + ":" + fmt.Sprintf("%x", sum)
}

func (runner *acpAgentRunner) startResidentProcess(
	ctx context.Context,
	spec acpResidentProcessSpec,
	router *acpClientRouter,
) (*acpResidentProcess, error) {
	factory := runner.residentProcessFactory
	if factory == nil {
		factory = defaultACPResidentProcessFactory
	}
	process, err := factory(ctx, spec, router)
	if err != nil {
		return nil, err
	}
	if process == nil || process.connection == nil {
		if process != nil {
			process.Close()
		}
		return nil, fmt.Errorf("starting ACP resident process: missing connection")
	}
	if process.router == nil {
		process.router = router
	}
	process.fingerprint = spec.fingerprint
	return process, nil
}

func (runner *acpAgentRunner) initializeResidentProcess(
	ctx context.Context,
	process *acpResidentProcess,
	spec acpResidentProcessSpec,
) error {
	if process == nil || process.connection == nil {
		return fmt.Errorf("initializing ACP resident process: missing connection")
	}
	acpLog().Debug("acp initialize starting", spec.logArgs...)
	initializeStartedAt := time.Now()
	initializeResponse, err := process.connection.Initialize(ctx, acp.InitializeRequest{
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
	})
	if err != nil {
		acpLog().Error("acp initialize failed", append(spec.logArgs, "error", err)...)
		return fmt.Errorf("initializing ACP agent: %w", err)
	}
	process.initializeResponse = initializeResponse
	acpLog().Info(
		"acp initialize completed",
		append(spec.logArgs,
			"duration_ms", time.Since(initializeStartedAt).Milliseconds(),
			"protocol_version", initializeResponse.ProtocolVersion,
			"agent", ImplementationLabel(initializeResponse.AgentInfo),
			"mcp_capability_acp", initializeResponse.AgentCapabilities.McpCapabilities.Acp,
			"mcp_capability_http", initializeResponse.AgentCapabilities.McpCapabilities.Http,
			"mcp_capability_sse", initializeResponse.AgentCapabilities.McpCapabilities.Sse,
			"resume_supported", initializeResponse.AgentCapabilities.SessionCapabilities.Resume != nil,
			"load_session_supported", initializeResponse.AgentCapabilities.LoadSession,
		)...,
	)
	return nil
}

func defaultACPResidentProcessFactory(
	ctx context.Context,
	spec acpResidentProcessSpec,
	router *acpClientRouter,
) (*acpResidentProcess, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	cmd := exec.Command(spec.command, spec.args...)
	if spec.dir != "" {
		cmd.Dir = spec.dir
	}
	cmd.Env = append([]string(nil), spec.env...)
	cmd.Stderr = acpRoutedStderrWriter{router: router}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("opening ACP stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("opening ACP stdout: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		acpLog().Error("acp process start failed", append(spec.logArgs, "error", err)...)
		return nil, fmt.Errorf("starting ACP agent %q: %w", spec.command, err)
	}
	startedAt := time.Now()
	pid := 0
	if cmd.Process != nil {
		pid = cmd.Process.Pid
	}
	acpLog().Info("acp process started", append(spec.logArgs, "pid", pid, "resident", true)...)
	connection := acp.NewClientSideConnection(router, stdin, newACPRoutedStdoutLogReader(stdout, router))
	connection.SetLogger(acpLog())
	return &acpResidentProcess{
		connection: connection,
		router:     router,
		closeFn: func() {
			cleanupACPProcess(cmd, stdin, stdout, spec.logArgs, pid, startedAt)
		},
	}, nil
}

func supportsResidentACP(command string, args []string) bool {
	return isCodexACPCommand(command, args) || isOpenCodeACPCommand(command, args)
}
