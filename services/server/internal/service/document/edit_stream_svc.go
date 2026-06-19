package document

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

// DocumentEditStreamRecord is the service-level state for a streamed edit.
type DocumentEditStreamRecord struct {
	ProjectID       string
	StreamID        string
	DocumentID      string
	Mode            string
	AnchorText      string
	Title           string
	ParentID        string
	BaseVersion     int
	Buffer          string
	Status          string
	RunID           string
	Before          AgentDocumentEditSnapshot
	OperationLogged bool
	CreatedAt       string
	UpdatedAt       string
}

// DocumentEditStreamRecordFromModel maps a persisted edit stream to a service record.
func DocumentEditStreamRecordFromModel(model domain.DocumentEditStreamModel) (DocumentEditStreamRecord, error) {
	before := AgentDocumentEditSnapshot{}
	if strings.TrimSpace(model.BeforeJSON) != "" {
		if err := json.Unmarshal([]byte(model.BeforeJSON), &before); err != nil {
			return DocumentEditStreamRecord{}, fmt.Errorf("decoding document edit stream snapshot %s: %w", model.StreamID, err)
		}
	}
	return DocumentEditStreamRecord{
		ProjectID:       model.ProjectID,
		StreamID:        model.StreamID,
		DocumentID:      model.DocumentID,
		Mode:            model.Mode,
		AnchorText:      model.AnchorText,
		Title:           model.Title,
		ParentID:        model.ParentID,
		BaseVersion:     model.BaseVersion,
		Buffer:          model.Buffer,
		Status:          model.Status,
		RunID:           model.RunID,
		Before:          before,
		OperationLogged: model.OperationLogged,
		CreatedAt:       model.CreatedAt,
		UpdatedAt:       model.UpdatedAt,
	}, nil
}

// PrepareDocumentEditStreamModel normalizes a stream record and returns its model.
func PrepareDocumentEditStreamModel(record DocumentEditStreamRecord) (DocumentEditStreamRecord, domain.DocumentEditStreamModel, error) {
	record.ProjectID = domain.CleanProjectID(record.ProjectID)
	record.StreamID = strings.TrimSpace(record.StreamID)
	if record.StreamID == "" {
		return record, domain.DocumentEditStreamModel{}, fmt.Errorf("streamId is required")
	}
	now := timestamp.NowRFC3339Nano()
	if record.CreatedAt == "" {
		record.CreatedAt = now
	}
	record.UpdatedAt = now
	if record.Status == "" {
		record.Status = "streaming"
	}
	beforeJSON, err := json.Marshal(record.Before)
	if err != nil {
		return record, domain.DocumentEditStreamModel{}, fmt.Errorf("encoding document edit stream snapshot: %w", err)
	}
	model := domain.DocumentEditStreamModel{
		ProjectID:       record.ProjectID,
		StreamID:        record.StreamID,
		DocumentID:      strings.TrimSpace(record.DocumentID),
		Mode:            strings.TrimSpace(record.Mode),
		AnchorText:      strings.TrimSpace(record.AnchorText),
		Title:           strings.TrimSpace(record.Title),
		ParentID:        strings.TrimSpace(record.ParentID),
		BaseVersion:     record.BaseVersion,
		Buffer:          record.Buffer,
		Status:          strings.TrimSpace(record.Status),
		RunID:           strings.TrimSpace(record.RunID),
		BeforeJSON:      string(beforeJSON),
		OperationLogged: record.OperationLogged,
		CreatedAt:       record.CreatedAt,
		UpdatedAt:       record.UpdatedAt,
	}
	return record, model, nil
}
