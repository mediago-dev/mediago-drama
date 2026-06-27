package acp

import (
	"bytes"
	"io"
	"os/exec"
	"strings"
	"time"
)

func cleanupACPProcess(cmd *exec.Cmd, stdin io.Closer, stdout io.Closer, logArgs []any, pid int, startedAt time.Time) {
	_ = stdin.Close()
	_ = stdout.Close()
	if cmd.Process != nil {
		if err := cmd.Process.Kill(); err != nil {
			acpLog().Warn("acp process kill failed", append(processLogAttrs(logArgs, pid, startedAt), "error", err)...)
		}
	}

	done := make(chan struct{})
	go func() {
		waitErr := cmd.Wait()
		attrs := processLogAttrs(logArgs, pid, startedAt)
		if waitErr != nil {
			attrs = append(attrs, "wait_error", waitErr)
		}
		acpLog().Info("acp process cleaned up", attrs...)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		acpLog().Warn("acp process cleanup still waiting", processLogAttrs(logArgs, pid, startedAt)...)
	}
}

func processLogAttrs(logArgs []any, pid int, startedAt time.Time) []any {
	attrs := append([]any(nil), logArgs...)
	return append(attrs, "pid", pid, "duration_ms", time.Since(startedAt).Milliseconds())
}

type acpStderrWriter struct {
	publish   func(agentEvent)
	sessionID string
	runID     string
	rawLog    *acpRawLogger
}

func (writer acpStderrWriter) Write(data []byte) (int, error) {
	message := strings.TrimSpace(string(data))
	if message != "" {
		logACPStderr(writer.sessionID, writer.runID, message)
		event := agentEvent{
			Type:    "agent.acp",
			Message: TruncateAgentMessage(message),
			ACP: &agentACPEvent{
				Kind:   ACPRuntimeLogKind,
				Status: "failed",
				Content: []AgentACPContentBlock{
					{
						Type: "terminal",
						Text: message,
					},
				},
			},
		}
		writer.rawLog.logStderr(message, event)
		writer.publish(event)
	}
	return len(data), nil
}

func logACPStderr(sessionID string, runID string, message string) {
	acpLog().Debug(
		"acp stderr",
		"session_id", sessionID,
		"run_id", runID,
		"message", TruncateAgentMessage(message),
	)
}

var _ io.Writer = acpStderrWriter{}

type acpStdoutLogReader struct {
	reader  io.Reader
	rawLog  *acpRawLogger
	pending []byte
	flushed bool
}

func newACPStdoutLogReader(reader io.Reader, rawLog *acpRawLogger) io.Reader {
	if reader == nil || rawLog == nil {
		return reader
	}
	return &acpStdoutLogReader{reader: reader, rawLog: rawLog}
}

func (reader *acpStdoutLogReader) Read(data []byte) (int, error) {
	n, err := reader.reader.Read(data)
	if n > 0 {
		reader.logChunk(data[:n])
	}
	if err == io.EOF {
		reader.flushPending()
	}
	return n, err
}

func (reader *acpStdoutLogReader) logChunk(data []byte) {
	reader.pending = append(reader.pending, data...)
	for {
		index := bytes.IndexByte(reader.pending, '\n')
		if index < 0 {
			return
		}
		line := string(reader.pending[:index+1])
		reader.rawLog.logStdoutLine(line)
		reader.pending = reader.pending[index+1:]
	}
}

func (reader *acpStdoutLogReader) flushPending() {
	if reader.flushed {
		return
	}
	reader.flushed = true
	if len(reader.pending) == 0 {
		return
	}
	reader.rawLog.logStdoutLine(string(reader.pending))
	reader.pending = nil
}

var _ io.Reader = (*acpStdoutLogReader)(nil)
