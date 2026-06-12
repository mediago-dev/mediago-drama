package acp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/service/shared"
)

type acpRawLogger struct {
	mu           sync.Mutex
	dir          string
	projectID    string
	sessionID    string
	runID        string
	acpSessionID string
}

type acpRawLogEntry struct {
	Timestamp    string `json:"timestamp"`
	ProjectID    string `json:"projectId,omitempty"`
	SessionID    string `json:"sessionId,omitempty"`
	RunID        string `json:"runId,omitempty"`
	ACPSessionID string `json:"acpSessionId,omitempty"`
	Source       string `json:"source"`
	Raw          any    `json:"raw,omitempty"`
	Normalized   any    `json:"normalized,omitempty"`
}

func newACPRawLogger(workspaceDir string, projectDir string, projectID string, sessionID string, runID string) *acpRawLogger {
	projectID = domain.CleanProjectID(projectID)
	return &acpRawLogger{
		dir:       acpRawLogDir(workspaceDir, projectDir, projectID, sessionID, runID),
		projectID: projectID,
		sessionID: strings.TrimSpace(sessionID),
		runID:     strings.TrimSpace(runID),
	}
}

func acpRawLogDir(workspaceDir string, projectDir string, projectID string, sessionID string, runID string) string {
	projectID = domain.CleanProjectID(projectID)
	baseDir := ""
	if projectID != "" && strings.TrimSpace(projectDir) != "" {
		baseDir = filepath.Join(shared.ResolveWorkspaceDir(projectDir), "agent-sessions")
	} else {
		baseDir = filepath.Join(shared.WorkspacePathsFor(workspaceDir).GlobalMetadataDir(), "agent-sessions")
	}

	segments := []string{baseDir}
	if projectID == "" || strings.TrimSpace(projectDir) == "" {
		segments = append(segments, safeACPRawLogSegment(projectID, "_global"))
	}
	segments = append(segments, safeACPRawLogSegment(sessionID, "_session"))
	return filepath.Join(segments...)
}

func (logger *acpRawLogger) setACPSessionID(acpSessionID string) {
	if logger == nil {
		return
	}
	logger.mu.Lock()
	defer logger.mu.Unlock()
	logger.acpSessionID = strings.TrimSpace(acpSessionID)
}

func (logger *acpRawLogger) logSessionUpdate(raw any, normalized *agentEvent) {
	if logger == nil {
		return
	}
	logger.writeJSONL(acpRawLogEntry{
		Timestamp:  time.Now().Format(time.RFC3339Nano),
		ProjectID:  logger.projectID,
		SessionID:  logger.sessionID,
		RunID:      logger.runID,
		Source:     "sdk.session_update",
		Raw:        jsonLogValue(raw),
		Normalized: jsonLogValue(normalized),
	})
}

func (logger *acpRawLogger) logStderr(message string, normalized agentEvent) {
	if logger == nil {
		return
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	logger.writeText("stderr.log", message+"\n")
	logger.writeJSONL(acpRawLogEntry{
		Timestamp:  time.Now().Format(time.RFC3339Nano),
		ProjectID:  logger.projectID,
		SessionID:  logger.sessionID,
		RunID:      logger.runID,
		Source:     "process.stderr",
		Raw:        message,
		Normalized: jsonLogValue(normalized),
	})
}

func (logger *acpRawLogger) logStdoutLine(line string) {
	if logger == nil {
		return
	}
	line = strings.TrimRight(line, "\r\n")
	if strings.TrimSpace(line) == "" {
		return
	}
	logger.writeText("stdout.log", line+"\n")
	logger.writeJSONL(acpRawLogEntry{
		Timestamp: time.Now().Format(time.RFC3339Nano),
		ProjectID: logger.projectID,
		SessionID: logger.sessionID,
		RunID:     logger.runID,
		Source:    "process.stdout",
		Raw:       line,
	})
}

func (logger *acpRawLogger) writeJSONL(entry acpRawLogEntry) {
	logger.mu.Lock()
	defer logger.mu.Unlock()
	entry.ACPSessionID = logger.acpSessionID
	data, err := json.Marshal(entry)
	if err != nil {
		acpLog().Warn("acp raw log marshal failed", "session_id", logger.sessionID, "run_id", logger.runID, "error", err)
		return
	}
	logger.appendFileLocked("acp-events.jsonl", append(data, '\n'))
}

func (logger *acpRawLogger) writeText(name string, text string) {
	logger.mu.Lock()
	defer logger.mu.Unlock()
	logger.appendFileLocked(name, []byte(text))
}

func (logger *acpRawLogger) appendFileLocked(name string, data []byte) {
	if err := os.MkdirAll(logger.dir, 0o700); err != nil {
		acpLog().Warn("acp raw log directory create failed", "path", logger.dir, "error", err)
		return
	}
	path := filepath.Join(logger.dir, name)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		acpLog().Warn("acp raw log open failed", "path", path, "error", err)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			acpLog().Warn("acp raw log close failed", "path", path, "error", err)
		}
	}()
	if _, err := file.Write(data); err != nil {
		acpLog().Warn("acp raw log write failed", "path", path, "error", err)
	}
}

func jsonLogValue(value any) any {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return map[string]string{"unmarshalable": fmt.Sprintf("%#v", value)}
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return string(data)
	}
	return decoded
}

func safeACPRawLogSegment(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	var builder strings.Builder
	for _, char := range value {
		if char == '.' || char == '-' || char == '_' || unicode.IsLetter(char) || unicode.IsDigit(char) {
			builder.WriteRune(char)
			continue
		}
		builder.WriteByte('_')
	}
	segment := strings.Trim(builder.String(), ". ")
	if segment == "" || segment == "." || segment == ".." {
		return fallback
	}
	return segment
}
