package acp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	acp "github.com/coder/acp-go-sdk"
)

func TestACPAgentRunnerReusesProcessAndRefreshesRunScopedMCP(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, func(AgentRunRequest) string {
		return "FIXED-INSTRUCTIONS-MUST-NOT-BE-IN-PROMPT"
	}, nil)
	runner.processConfigProvider = ProcessConfigProviderFunc(func(context.Context, ProcessConfigRequest) (ProcessConfig, error) {
		return ProcessConfig{NativeInstructionsInjected: true}, nil
	})
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() {
		if err := runner.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
	})

	firstEvents := &residentEventCollector{}
	first, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-1", "first user turn"), firstEvents.publish)
	if err != nil {
		t.Fatalf("first Run() error = %v", err)
	}
	if first.ACPSessionID != "acp-session-1" {
		t.Fatalf("first ACP session = %q, want acp-session-1", first.ACPSessionID)
	}
	firstEventCount := len(firstEvents.Events())

	secondRequest := residentRunRequest(workspaceDir, "run-2", "second user turn")
	secondRequest.ACPSessionID = first.ACPSessionID
	secondRequest.ACPInstructionHash = first.ACPInstructionHash
	secondRequest.Document = &AgentDocumentContext{ID: "doc-2"}
	secondRequest.SelectionText = "selected in run two"
	secondEvents := &residentEventCollector{}
	second, err := runner.Run(context.Background(), secondRequest, secondEvents.publish)
	if err != nil {
		t.Fatalf("second Run() error = %v", err)
	}

	connections := factory.Connections()
	if len(connections) != 1 {
		t.Fatalf("process starts = %d, want 1", len(connections))
	}
	connection := connections[0]
	initializeCount, newRequests, resumeRequests, promptRequests := connection.Snapshot()
	if initializeCount != 1 {
		t.Fatalf("Initialize calls = %d, want 1", initializeCount)
	}
	if len(newRequests) != 1 {
		t.Fatalf("NewSession calls = %d, want 1", len(newRequests))
	}
	if len(resumeRequests) != 1 {
		t.Fatalf("ResumeSession calls = %d, want 1 on the second run", len(resumeRequests))
	}
	if len(promptRequests) != 2 {
		t.Fatalf("Prompt calls = %d, want 2", len(promptRequests))
	}
	if resumeRequests[0].SessionId != acp.SessionId(first.ACPSessionID) {
		t.Fatalf("resumed ACP session = %q, want %q", resumeRequests[0].SessionId, first.ACPSessionID)
	}
	if len(resumeRequests[0].McpServers) == 0 || resumeRequests[0].McpServers[0].Http == nil {
		t.Fatalf("second resume MCP servers = %#v, want HTTP document MCP", resumeRequests[0].McpServers)
	}
	secondMCPURL := resumeRequests[0].McpServers[0].Http.Url
	for _, fragment := range []string{"runId=run-2", "activeDocumentId=doc-2", "selectionText=selected"} {
		if !strings.Contains(secondMCPURL, fragment) {
			t.Fatalf("second resume MCP URL = %q, want fragment %q", secondMCPURL, fragment)
		}
	}
	if strings.Contains(secondMCPURL, "runId=run-1") {
		t.Fatalf("second resume MCP URL retained first run: %q", secondMCPURL)
	}
	for index, promptRequest := range promptRequests {
		promptText := ACPContentBlockText(promptRequest.Prompt[0])
		if strings.Contains(promptText, "FIXED-INSTRUCTIONS-MUST-NOT-BE-IN-PROMPT") {
			t.Fatalf("prompt %d contains fixed native instructions: %q", index+1, promptText)
		}
	}
	if second.Message != "reply-2" {
		t.Fatalf("second message = %q, want reply-2", second.Message)
	}
	if got := len(firstEvents.Events()); got != firstEventCount {
		t.Fatalf("second turn appended %d events to the first turn collector", got-firstEventCount)
	}
	for _, event := range secondEvents.Events() {
		if event.RunID != "run-2" || event.TurnID != "run-2" {
			t.Fatalf("second event scope = run %q turn %q, want run-2", event.RunID, event.TurnID)
		}
	}
	if _, ok := runner.activeClients.Load("mediago-session-1"); ok {
		t.Fatal("active client remained registered after run")
	}
}

func TestResidentACPProcessFingerprintUsesOnlyStableLaunchInputs(t *testing.T) {
	base := acpResidentProcessSpec{
		command:         "codex-acp",
		args:            []string{"--flag", "value"},
		dir:             "/workspace/project",
		workspaceDir:    "/workspace",
		env:             []string{"SECRET=one", "MODE=test"},
		configDir:       "/workspace/config",
		instructionHash: "instruction-v1:abc",
	}
	baseline := residentACPProcessFingerprint(base)
	reordered := base
	reordered.env = []string{"MODE=test", "SECRET=one"}
	if got := residentACPProcessFingerprint(reordered); got != baseline {
		t.Fatalf("fingerprint changed with env insertion order: %q != %q", got, baseline)
	}

	tests := []struct {
		name string
		edit func(*acpResidentProcessSpec)
	}{
		{name: "command", edit: func(spec *acpResidentProcessSpec) { spec.command = "opencode" }},
		{name: "args", edit: func(spec *acpResidentProcessSpec) { spec.args = []string{"acp"} }},
		{name: "directory", edit: func(spec *acpResidentProcessSpec) { spec.dir = "/workspace/other" }},
		{name: "workspace", edit: func(spec *acpResidentProcessSpec) { spec.workspaceDir = "/other" }},
		{name: "environment value", edit: func(spec *acpResidentProcessSpec) { spec.env = []string{"SECRET=two", "MODE=test"} }},
		{name: "config directory", edit: func(spec *acpResidentProcessSpec) { spec.configDir = "/workspace/config-2" }},
		{name: "instructions", edit: func(spec *acpResidentProcessSpec) { spec.instructionHash = "instruction-v1:def" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			changed := base
			test.edit(&changed)
			if got := residentACPProcessFingerprint(changed); got == baseline {
				t.Fatalf("fingerprint did not change for %s", test.name)
			}
		})
	}
}

func TestACPRoutedStderrWriterUsesOnlyCurrentRunBinding(t *testing.T) {
	router := &acpClientRouter{}
	firstEvents := &residentEventCollector{}
	firstClient := &acpClient{
		publish:   scopedACPEventPublisher("run-1", firstEvents.publish),
		sessionID: "session-1",
		runID:     "run-1",
	}
	if err := router.bind(firstClient); err != nil {
		t.Fatalf("bind first client error = %v", err)
	}
	writer := acpRoutedStderrWriter{router: router}
	if _, err := writer.Write([]byte("first diagnostic\n")); err != nil {
		t.Fatalf("first Write() error = %v", err)
	}
	router.unbind(firstClient)
	if _, err := writer.Write([]byte("between runs\n")); err != nil {
		t.Fatalf("unbound Write() error = %v", err)
	}

	secondEvents := &residentEventCollector{}
	secondClient := &acpClient{
		publish:   scopedACPEventPublisher("run-2", secondEvents.publish),
		sessionID: "session-1",
		runID:     "run-2",
	}
	if err := router.bind(secondClient); err != nil {
		t.Fatalf("bind second client error = %v", err)
	}
	if _, err := writer.Write([]byte("second diagnostic\n")); err != nil {
		t.Fatalf("second Write() error = %v", err)
	}
	router.unbind(secondClient)

	first := firstEvents.Events()
	second := secondEvents.Events()
	if len(first) != 1 || first[0].RunID != "run-1" || first[0].Message != "first diagnostic" {
		t.Fatalf("first events = %#v, want only run-1 diagnostic", first)
	}
	if len(second) != 1 || second[0].RunID != "run-2" || second[0].Message != "second diagnostic" {
		t.Fatalf("second events = %#v, want only run-2 diagnostic", second)
	}
}

func TestACPClientRouterUnbindWaitsForInFlightCallback(t *testing.T) {
	router := &acpClientRouter{}
	callbackStarted := make(chan struct{})
	releaseCallback := make(chan struct{})
	callbackStartOnce := sync.Once{}
	client := &acpClient{
		publish: func(agentEvent) {
			callbackStartOnce.Do(func() { close(callbackStarted) })
			<-releaseCallback
		},
		sessionID: "session-1",
		runID:     "run-1",
	}
	client.setAcceptingSessionUpdates(true)
	client.beginPromptMetrics()
	if err := router.bind(client); err != nil {
		t.Fatalf("bind client error = %v", err)
	}

	updateDone := make(chan error, 1)
	go func() {
		updateDone <- router.SessionUpdate(context.Background(), acp.SessionNotification{
			SessionId: "acp-session-1",
			Update:    acp.UpdateAgentMessageText("in flight"),
		})
	}()
	waitForResidentProcessClose(t, callbackStarted, "callback start")

	unbindDone := make(chan struct{})
	go func() {
		router.unbind(client)
		close(unbindDone)
	}()
	select {
	case <-unbindDone:
		close(releaseCallback)
		t.Fatal("unbind completed before the in-flight callback drained")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseCallback)
	waitForResidentProcessClose(t, unbindDone, "callback drain barrier")
	select {
	case err := <-updateDone:
		if err != nil {
			t.Fatalf("SessionUpdate() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for session update")
	}
	if err := router.bind(&acpClient{}); err != nil {
		t.Fatalf("binding next run after callback drain error = %v", err)
	}
}

func TestACPAgentRunnerRestartsResidentProcessWhenLaunchConfigChanges(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, func(AgentRunRequest) string { return "fixed" }, nil)
	var providerMu sync.Mutex
	providerCall := 0
	runner.processConfigProvider = ProcessConfigProviderFunc(func(context.Context, ProcessConfigRequest) (ProcessConfig, error) {
		providerMu.Lock()
		defer providerMu.Unlock()
		providerCall++
		return ProcessConfig{
			Env:                        map[string]string{"MEDIAGO_TEST_PROCESS_VERSION": fmt.Sprintf("v%d", providerCall)},
			NativeInstructionsInjected: true,
		}, nil
	})
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() { _ = runner.Close() })

	first, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-1", "first"), func(AgentEvent) {})
	if err != nil {
		t.Fatalf("first Run() error = %v", err)
	}
	secondRequest := residentRunRequest(workspaceDir, "run-2", "second")
	secondRequest.ACPSessionID = first.ACPSessionID
	secondRequest.ACPInstructionHash = first.ACPInstructionHash
	if _, err := runner.Run(context.Background(), secondRequest, func(AgentEvent) {}); err != nil {
		t.Fatalf("second Run() error = %v", err)
	}

	connections := factory.Connections()
	if len(connections) != 2 {
		t.Fatalf("process starts = %d, want 2 after launch config change", len(connections))
	}
	if got := connections[0].CloseCount(); got != 1 {
		t.Fatalf("old process closes = %d, want 1", got)
	}
	initializeCount, newRequests, resumeRequests, _ := connections[1].Snapshot()
	if initializeCount != 1 || len(newRequests) != 0 || len(resumeRequests) != 1 {
		t.Fatalf(
			"replacement calls = initialize %d new %d resume %d, want 1/0/1",
			initializeCount,
			len(newRequests),
			len(resumeRequests),
		)
	}
}

func TestACPAgentRunnerDiscardsResidentProcessAfterPromptFailure(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{promptErrors: []error{errors.New("prompt failed"), nil}}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() { _ = runner.Close() })

	if _, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-1", "fail"), func(AgentEvent) {}); err == nil {
		t.Fatal("first Run() error = nil, want prompt failure")
	}
	connections := factory.Connections()
	if len(connections) != 1 {
		t.Fatalf("failed process starts = %d, want 1", len(connections))
	}
	if got := connections[0].CloseCount(); got != 1 {
		t.Fatalf("failed process closes = %d, want 1", got)
	}
	if _, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-2", "retry"), func(AgentEvent) {}); err != nil {
		t.Fatalf("retry Run() error = %v", err)
	}
	if got := len(factory.Connections()); got != 2 {
		t.Fatalf("process starts after retry = %d, want 2", got)
	}
}

func TestACPAgentRunnerScopesResidentProcessesByMediaGoSession(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() { _ = runner.Close() })

	firstRequest := residentRunRequest(workspaceDir, "run-1", "first")
	if _, err := runner.Run(context.Background(), firstRequest, func(AgentEvent) {}); err != nil {
		t.Fatalf("first Run() error = %v", err)
	}
	secondRequest := residentRunRequest(workspaceDir, "run-2", "second")
	secondRequest.SessionID = "mediago-session-2"
	if _, err := runner.Run(context.Background(), secondRequest, func(AgentEvent) {}); err != nil {
		t.Fatalf("second Run() error = %v", err)
	}
	if got := len(factory.Connections()); got != 2 {
		t.Fatalf("process starts = %d, want one per MediaGo session", got)
	}
}

func TestACPAgentRunnerKeepsCustomBackendsProcessPerRun(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{}
	runner := NewACPAgentRunner("custom-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() { _ = runner.Close() })

	for index := 1; index <= 2; index++ {
		request := residentRunRequest(workspaceDir, fmt.Sprintf("run-%d", index), fmt.Sprintf("turn-%d", index))
		if _, err := runner.Run(context.Background(), request, func(AgentEvent) {}); err != nil {
			t.Fatalf("Run %d error = %v", index, err)
		}
	}
	connections := factory.Connections()
	if len(connections) != 2 {
		t.Fatalf("custom backend process starts = %d, want 2", len(connections))
	}
	for index, connection := range connections {
		if got := connection.CloseCount(); got != 1 {
			t.Fatalf("custom backend process %d closes = %d, want 1", index+1, got)
		}
	}
}

func TestACPAgentRunnerIdleEvictsResidentProcess(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	runner.residentIdleTimeout = 10 * time.Millisecond
	t.Cleanup(func() { _ = runner.Close() })

	first, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-1", "first"), func(AgentEvent) {})
	if err != nil {
		t.Fatalf("first Run() error = %v", err)
	}
	firstConnection := factory.Connections()[0]
	waitForResidentProcessClose(t, firstConnection.done, "idle eviction")
	if got := firstConnection.CloseCount(); got != 1 {
		t.Fatalf("idle process closes = %d, want 1", got)
	}

	secondRequest := residentRunRequest(workspaceDir, "run-2", "second")
	secondRequest.ACPSessionID = first.ACPSessionID
	secondRequest.ACPInstructionHash = first.ACPInstructionHash
	if _, err := runner.Run(context.Background(), secondRequest, func(AgentEvent) {}); err != nil {
		t.Fatalf("second Run() error = %v", err)
	}
	if got := len(factory.Connections()); got != 2 {
		t.Fatalf("process starts after idle eviction = %d, want 2", got)
	}
}

func TestACPAgentRunnerCloseIsIdempotent(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	if _, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-1", "first"), func(AgentEvent) {}); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	connection := factory.Connections()[0]

	const closeCount = 8
	var group sync.WaitGroup
	group.Add(closeCount)
	for range closeCount {
		go func() {
			defer group.Done()
			if err := runner.Close(); err != nil {
				t.Errorf("Close() error = %v", err)
			}
		}()
	}
	group.Wait()
	if got := connection.CloseCount(); got != 1 {
		t.Fatalf("process closes = %d, want 1", got)
	}
	if _, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-2", "after close"), func(AgentEvent) {}); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("Run() after Close error = %v, want closed", err)
	}
}

func TestACPAgentRunnerCloseTerminatesProcessDuringInitialize(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{
		created:                             make(chan *fakeResidentACPConnection, 1),
		waitForProcessCloseDuringInitialize: []bool{true},
	}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start

	runDone := make(chan error, 1)
	go func() {
		_, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-1", "first"), func(AgentEvent) {})
		runDone <- err
	}()
	connection := waitForResidentConnection(t, factory)
	waitForResidentProcessClose(t, connection.initializeStarted, "initialize start")
	if err := runner.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	select {
	case err := <-runDone:
		if err == nil || !strings.Contains(err.Error(), "initialize") {
			t.Fatalf("Run() error = %v, want initialize failure after shutdown", err)
		}
	case <-time.After(time.Second):
		t.Fatal("runner Close did not unblock Initialize")
	}
	if got := connection.CloseCount(); got != 1 {
		t.Fatalf("initializing process closes = %d, want 1", got)
	}
}

func TestACPAgentRunnerSerializesRunsForSameMediaGoSession(t *testing.T) {
	workspaceDir := t.TempDir()
	releaseFirstPrompt := make(chan struct{})
	factory := &fakeResidentACPFactory{
		blockFirstPrompt:   true,
		releaseFirstPrompt: releaseFirstPrompt,
	}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() { _ = runner.Close() })

	instructionHash := instructionFingerprint("codex", "inline", "")
	firstRequest := residentRunRequest(workspaceDir, "run-1", "first")
	firstRequest.ACPSessionID = "acp-session-existing"
	firstRequest.ACPInstructionHash = instructionHash
	secondRequest := residentRunRequest(workspaceDir, "run-2", "second")
	secondRequest.ACPSessionID = "acp-session-existing"
	secondRequest.ACPInstructionHash = instructionHash

	firstDone := make(chan error, 1)
	go func() {
		_, err := runner.Run(context.Background(), firstRequest, func(AgentEvent) {})
		firstDone <- err
	}()
	connection := waitForResidentConnection(t, factory)
	waitForResidentProcessClose(t, connection.promptStarted, "first prompt start")

	secondDone := make(chan error, 1)
	go func() {
		_, err := runner.Run(context.Background(), secondRequest, func(AgentEvent) {})
		secondDone <- err
	}()
	select {
	case err := <-secondDone:
		t.Fatalf("second Run() finished before first prompt was released: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseFirstPrompt)
	for index, done := range []<-chan error{firstDone, secondDone} {
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("Run %d error = %v", index+1, err)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for Run %d", index+1)
		}
	}
	if got := len(factory.Connections()); got != 1 {
		t.Fatalf("process starts = %d, want 1", got)
	}
	if got := connection.MaxActivePrompts(); got != 1 {
		t.Fatalf("maximum concurrent prompts = %d, want 1", got)
	}
}

func TestACPAgentRunnerDiscardsResidentProcessAfterCancellation(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{
		created:             make(chan *fakeResidentACPConnection, 2),
		waitForCancellation: []bool{true, false},
	}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() { _ = runner.Close() })

	ctx, cancel := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		_, err := runner.Run(ctx, residentRunRequest(workspaceDir, "run-1", "cancel"), func(AgentEvent) {})
		firstDone <- err
	}()
	firstConnection := waitForResidentConnection(t, factory)
	waitForResidentProcessClose(t, firstConnection.promptStarted, "cancelled prompt start")
	cancel()
	select {
	case err := <-firstDone:
		if !errors.Is(err, context.Canceled) && (err == nil || !strings.Contains(err.Error(), context.Canceled.Error())) {
			t.Fatalf("cancelled Run() error = %v, want context canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cancelled Run")
	}
	if got := firstConnection.CloseCount(); got != 1 {
		t.Fatalf("cancelled process closes = %d, want 1", got)
	}

	if _, err := runner.Run(context.Background(), residentRunRequest(workspaceDir, "run-2", "retry"), func(AgentEvent) {}); err != nil {
		t.Fatalf("retry Run() error = %v", err)
	}
	if got := len(factory.Connections()); got != 2 {
		t.Fatalf("process starts after cancellation = %d, want 2", got)
	}
}

func TestACPAgentRunnerForcesResidentProcessClosedWhenPromptIgnoresCancellation(t *testing.T) {
	workspaceDir := t.TempDir()
	factory := &fakeResidentACPFactory{
		created:             make(chan *fakeResidentACPConnection, 1),
		waitForProcessClose: []bool{true},
	}
	runner := NewACPAgentRunner("codex-acp", workspaceDir, nil, nil)
	runner.residentProcessFactory = factory.Start
	t.Cleanup(func() { _ = runner.Close() })

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := runner.Run(ctx, residentRunRequest(workspaceDir, "run-1", "cancel"), func(AgentEvent) {})
		done <- err
	}()
	connection := waitForResidentConnection(t, factory)
	waitForResidentProcessClose(t, connection.promptStarted, "stuck prompt start")
	cancelledAt := time.Now()
	cancel()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), context.Canceled.Error()) {
			t.Fatalf("cancelled Run() error = %v, want context canceled", err)
		}
		if elapsed := time.Since(cancelledAt); elapsed < residentACPCancelGracePeriod {
			t.Fatalf("stuck prompt returned after %v, want cancellation grace period %v", elapsed, residentACPCancelGracePeriod)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for cancellation watchdog")
	}
	if got := connection.CloseCount(); got != 1 {
		t.Fatalf("watchdog process closes = %d, want 1", got)
	}
}

func waitForResidentProcessClose(t *testing.T, done <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

func waitForResidentConnection(t *testing.T, factory *fakeResidentACPFactory) *fakeResidentACPConnection {
	t.Helper()
	if factory.created != nil {
		select {
		case connection := <-factory.created:
			return connection
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for resident connection")
		}
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		connections := factory.Connections()
		if len(connections) > 0 {
			return connections[0]
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("timed out waiting for resident connection")
	return nil
}

func residentRunRequest(workspaceDir string, runID string, prompt string) AgentRunRequest {
	return AgentRunRequest{
		SessionID:    "mediago-session-1",
		RunID:        runID,
		ProjectID:    "project-1",
		Prompt:       prompt,
		WorkspaceDir: workspaceDir,
		ProjectDir:   workspaceDir,
		WorkingDir:   workspaceDir,
		BridgeURL:    "http://127.0.0.1:48123",
		BridgeToken:  "bridge-test-token",
	}
}

type fakeResidentACPFactory struct {
	mu                                  sync.Mutex
	connections                         []*fakeResidentACPConnection
	promptErrors                        []error
	waitForCancellation                 []bool
	waitForProcessClose                 []bool
	waitForProcessCloseDuringInitialize []bool
	blockFirstPrompt                    bool
	releaseFirstPrompt                  <-chan struct{}
	created                             chan *fakeResidentACPConnection
}

func (factory *fakeResidentACPFactory) Start(
	_ context.Context,
	_ acpResidentProcessSpec,
	router *acpClientRouter,
) (*acpResidentProcess, error) {
	factory.mu.Lock()
	defer factory.mu.Unlock()
	connection := &fakeResidentACPConnection{
		router:             router,
		done:               make(chan struct{}),
		initializeStarted:  make(chan struct{}),
		promptStarted:      make(chan struct{}),
		blockFirstPrompt:   factory.blockFirstPrompt,
		releaseFirstPrompt: factory.releaseFirstPrompt,
	}
	index := len(factory.connections)
	if index < len(factory.promptErrors) {
		connection.promptError = factory.promptErrors[index]
	}
	if index < len(factory.waitForCancellation) {
		connection.waitForCancellation = factory.waitForCancellation[index]
	}
	if index < len(factory.waitForProcessClose) {
		connection.waitForProcessClose = factory.waitForProcessClose[index]
	}
	if index < len(factory.waitForProcessCloseDuringInitialize) {
		connection.waitForProcessCloseDuringInitialize = factory.waitForProcessCloseDuringInitialize[index]
	}
	factory.connections = append(factory.connections, connection)
	if factory.created != nil {
		factory.created <- connection
	}
	return &acpResidentProcess{
		connection: connection,
		router:     router,
		closeFn:    connection.close,
	}, nil
}

func (factory *fakeResidentACPFactory) Connections() []*fakeResidentACPConnection {
	factory.mu.Lock()
	defer factory.mu.Unlock()
	return append([]*fakeResidentACPConnection(nil), factory.connections...)
}

type fakeResidentACPConnection struct {
	mu                                  sync.Mutex
	router                              *acpClientRouter
	done                                chan struct{}
	closeOnce                           sync.Once
	closeCount                          int
	initializeCount                     int
	initializeStarted                   chan struct{}
	initializeStartOnce                 sync.Once
	waitForProcessCloseDuringInitialize bool
	newRequests                         []acp.NewSessionRequest
	resumeRequests                      []acp.ResumeSessionRequest
	promptRequests                      []acp.PromptRequest
	promptError                         error
	promptStarted                       chan struct{}
	promptStartOnce                     sync.Once
	blockFirstPrompt                    bool
	releaseFirstPrompt                  <-chan struct{}
	waitForCancellation                 bool
	waitForProcessClose                 bool
	activePrompts                       int
	maxActivePrompts                    int
}

func (connection *fakeResidentACPConnection) Initialize(context.Context, acp.InitializeRequest) (acp.InitializeResponse, error) {
	connection.mu.Lock()
	connection.initializeCount++
	waitForProcessClose := connection.waitForProcessCloseDuringInitialize
	connection.mu.Unlock()
	connection.initializeStartOnce.Do(func() { close(connection.initializeStarted) })
	if waitForProcessClose {
		<-connection.done
		return acp.InitializeResponse{}, errors.New("process closed during initialize")
	}
	return acp.InitializeResponse{
		ProtocolVersion: acp.ProtocolVersionNumber,
		AgentCapabilities: acp.AgentCapabilities{
			LoadSession: true,
			McpCapabilities: acp.McpCapabilities{
				Http: true,
			},
			SessionCapabilities: acp.SessionCapabilities{
				Resume: &acp.SessionResumeCapabilities{},
			},
		},
	}, nil
}

func (connection *fakeResidentACPConnection) NewSession(_ context.Context, request acp.NewSessionRequest) (acp.NewSessionResponse, error) {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	connection.newRequests = append(connection.newRequests, request)
	return acp.NewSessionResponse{SessionId: "acp-session-1"}, nil
}

func (connection *fakeResidentACPConnection) ResumeSession(_ context.Context, request acp.ResumeSessionRequest) (acp.ResumeSessionResponse, error) {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	connection.resumeRequests = append(connection.resumeRequests, request)
	return acp.ResumeSessionResponse{}, nil
}

func (connection *fakeResidentACPConnection) LoadSession(context.Context, acp.LoadSessionRequest) (acp.LoadSessionResponse, error) {
	return acp.LoadSessionResponse{}, nil
}

func (connection *fakeResidentACPConnection) Prompt(ctx context.Context, request acp.PromptRequest) (acp.PromptResponse, error) {
	connection.mu.Lock()
	connection.promptRequests = append(connection.promptRequests, request)
	promptNumber := len(connection.promptRequests)
	promptError := connection.promptError
	blockFirstPrompt := connection.blockFirstPrompt && promptNumber == 1
	releaseFirstPrompt := connection.releaseFirstPrompt
	waitForCancellation := connection.waitForCancellation
	waitForProcessClose := connection.waitForProcessClose
	connection.activePrompts++
	if connection.activePrompts > connection.maxActivePrompts {
		connection.maxActivePrompts = connection.activePrompts
	}
	connection.mu.Unlock()
	connection.promptStartOnce.Do(func() {
		close(connection.promptStarted)
	})
	defer func() {
		connection.mu.Lock()
		connection.activePrompts--
		connection.mu.Unlock()
	}()
	if waitForCancellation {
		<-ctx.Done()
		return acp.PromptResponse{}, ctx.Err()
	}
	if waitForProcessClose {
		<-connection.done
		if ctx.Err() != nil {
			return acp.PromptResponse{}, ctx.Err()
		}
		return acp.PromptResponse{}, errors.New("resident process closed")
	}
	if blockFirstPrompt && releaseFirstPrompt != nil {
		<-releaseFirstPrompt
	}
	if promptError != nil {
		return acp.PromptResponse{}, promptError
	}
	if err := connection.router.SessionUpdate(ctx, acp.SessionNotification{
		SessionId: request.SessionId,
		Update:    acp.UpdateAgentMessageText(fmt.Sprintf("reply-%d", promptNumber)),
	}); err != nil {
		return acp.PromptResponse{}, err
	}
	return acp.PromptResponse{StopReason: acp.StopReasonEndTurn}, nil
}

func (connection *fakeResidentACPConnection) SetSessionConfigOption(context.Context, acp.SetSessionConfigOptionRequest) (acp.SetSessionConfigOptionResponse, error) {
	return acp.SetSessionConfigOptionResponse{}, nil
}

func (connection *fakeResidentACPConnection) SetSessionMode(context.Context, acp.SetSessionModeRequest) (acp.SetSessionModeResponse, error) {
	return acp.SetSessionModeResponse{}, nil
}

func (connection *fakeResidentACPConnection) Done() <-chan struct{} {
	return connection.done
}

func (connection *fakeResidentACPConnection) close() {
	connection.closeOnce.Do(func() {
		connection.mu.Lock()
		connection.closeCount++
		connection.mu.Unlock()
		close(connection.done)
	})
}

func (connection *fakeResidentACPConnection) CloseCount() int {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	return connection.closeCount
}

func (connection *fakeResidentACPConnection) MaxActivePrompts() int {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	return connection.maxActivePrompts
}

func (connection *fakeResidentACPConnection) Snapshot() (
	int,
	[]acp.NewSessionRequest,
	[]acp.ResumeSessionRequest,
	[]acp.PromptRequest,
) {
	connection.mu.Lock()
	defer connection.mu.Unlock()
	return connection.initializeCount,
		append([]acp.NewSessionRequest(nil), connection.newRequests...),
		append([]acp.ResumeSessionRequest(nil), connection.resumeRequests...),
		append([]acp.PromptRequest(nil), connection.promptRequests...)
}

type residentEventCollector struct {
	mu     sync.Mutex
	events []AgentEvent
}

func (collector *residentEventCollector) publish(event AgentEvent) {
	collector.mu.Lock()
	defer collector.mu.Unlock()
	collector.events = append(collector.events, event)
}

func (collector *residentEventCollector) Events() []AgentEvent {
	collector.mu.Lock()
	defer collector.mu.Unlock()
	return append([]AgentEvent(nil), collector.events...)
}
