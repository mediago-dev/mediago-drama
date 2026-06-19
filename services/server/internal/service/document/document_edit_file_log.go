package document

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

func (store *Service) appendDocumentEditFileLog(projectID string, record documentOperationLogRecord, fallbackTitle string) error {
	title := documentEditLogTitle(record, fallbackTitle)
	path := filepath.Join(store.documentEditLogsDir(projectID), documentEditLogFilename(title, record.DocumentID))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating document edit log directory: %w", err)
	}
	entry, err := formatDocumentEditLogEntry(record)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("opening document edit log %s: %w", filepath.Base(path), err)
	}
	defer file.Close()
	if _, err := file.WriteString(entry); err != nil {
		return fmt.Errorf("writing document edit log %s: %w", filepath.Base(path), err)
	}
	return nil
}

func (store *Service) appendDocumentDeleteFileLog(projectID string, document mediamcp.WorkspaceDocument) error {
	now := timestamp.NowRFC3339Nano()
	summary := "已删除《" + document.Title + "》。"
	record := documentOperationLogRecord{
		ID:         mustRandomID("oplog"),
		DocumentID: document.ID,
		Operations: []map[string]any{
			{
				"id":        mustRandomID("op"),
				"type":      "delete_document",
				"summary":   summary,
				"target":    map[string]any{"documentId": document.ID},
				"payload":   map[string]any{"title": document.Title},
				"createdAt": now,
			},
		},
		Summary:   summary,
		Source:    "document-store",
		CreatedAt: now,
		Before: DocumentSnapshotRecord{
			Title:    document.Title,
			Content:  document.Content,
			Comments: document.Comments,
		},
		After: DocumentSnapshotRecord{
			Title:    document.Title,
			Content:  "",
			Comments: []mediamcp.DocumentComment{},
		},
	}
	return store.appendDocumentEditFileLog(projectID, record, document.Title)
}

func (store *Service) documentEditLogsDir(projectID string) string {
	if strings.TrimSpace(projectID) != "" {
		if projectDir := store.projectDir(projectID); projectDir != "" {
			return filepath.Join(projectDir, "logs")
		}
	}
	return filepath.Join(store.metadataDir(projectID), "logs")
}

func formatDocumentEditLogEntry(record documentOperationLogRecord) (string, error) {
	createdAt := firstNonEmpty(record.CreatedAt, timestamp.NowRFC3339Nano())
	summary := firstNonEmpty(record.Summary, "无摘要")
	source := firstNonEmpty(record.Source, "unknown")
	operations := "[]"
	if len(record.Operations) > 0 {
		data, err := json.MarshalIndent(record.Operations, "", "  ")
		if err != nil {
			return "", fmt.Errorf("encoding document edit operations: %w", err)
		}
		operations = string(data)
	}

	var builder strings.Builder
	builder.WriteString("================================================================================\n")
	fmt.Fprintf(&builder, "time: %s\n", createdAt)
	fmt.Fprintf(&builder, "source: %s\n", source)
	fmt.Fprintf(&builder, "documentId: %s\n", record.DocumentID)
	fmt.Fprintf(&builder, "summary: %s\n", summary)
	fmt.Fprintf(&builder, "beforeTitle: %s\n", record.Before.Title)
	fmt.Fprintf(&builder, "afterTitle: %s\n", record.After.Title)
	builder.WriteString("operations:\n")
	builder.WriteString(operations)
	builder.WriteString("\n\n--- before ---\n")
	builder.WriteString(ensureTrailingNewline(record.Before.Content))
	builder.WriteString("--- after ---\n")
	builder.WriteString(ensureTrailingNewline(record.After.Content))
	builder.WriteString("\n")
	return builder.String(), nil
}

func documentEditLogTitle(record documentOperationLogRecord, fallbackTitle string) string {
	return firstNonEmpty(record.After.Title, fallbackTitle, record.Before.Title, record.DocumentID, "untitled")
}

func documentEditLogFilename(title string, documentID string) string {
	stem := cleanDocumentEditLogFilenameStem(title)
	if stem == "" {
		stem = cleanDocumentEditLogFilenameStem(documentID)
	}
	if stem == "" {
		stem = "untitled"
	}
	return stem + "-edit.txt"
}

func cleanDocumentEditLogFilenameStem(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|':
			builder.WriteRune('-')
		case unicode.IsControl(r):
			continue
		default:
			builder.WriteRune(r)
		}
	}
	cleaned := strings.Join(strings.Fields(builder.String()), " ")
	cleaned = strings.Trim(cleaned, ".- ")
	runes := []rune(cleaned)
	if len(runes) > 80 {
		cleaned = strings.TrimSpace(string(runes[:80]))
	}
	return cleaned
}

func ensureTrailingNewline(value string) string {
	if value == "" || strings.HasSuffix(value, "\n") {
		return value
	}
	return value + "\n"
}
