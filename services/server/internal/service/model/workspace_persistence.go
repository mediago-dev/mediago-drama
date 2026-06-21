package model

import (
	"encoding/json"
	"fmt"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
)

// DocumentOperationLogRecordsFromModels decodes operation log models.
func DocumentOperationLogRecordsFromModels(models []domain.DocumentOperationLogModel) ([]DocumentOperationLogRecord, error) {
	operationLog := make([]DocumentOperationLogRecord, 0, len(models))
	for _, model := range models {
		var record DocumentOperationLogRecord
		if err := json.Unmarshal([]byte(model.RecordJSON), &record); err != nil {
			return nil, fmt.Errorf("decoding operation log record: %w", err)
		}
		operationLog = append(operationLog, record)
	}
	return operationLog, nil
}

// DocumentOperationLogModelsFromRecords maps operation records to persisted models.
func DocumentOperationLogModelsFromRecords(projectID string, records []DocumentOperationLogRecord) ([]DocumentOperationLogRecord, []domain.DocumentOperationLogModel, error) {
	normalized := make([]DocumentOperationLogRecord, 0, len(records))
	models := make([]domain.DocumentOperationLogModel, 0, len(records))
	now := timestamp.NowRFC3339Nano()
	for index, record := range records {
		if record.ID == "" {
			record.ID = fmt.Sprintf("oplog-%d", index+1)
		}
		if record.CreatedAt == "" {
			record.CreatedAt = now
		}
		recordJSON, err := json.Marshal(record)
		if err != nil {
			return nil, nil, fmt.Errorf("encoding operation log %s: %w", record.ID, err)
		}
		normalized = append(normalized, record)
		models = append(models, domain.DocumentOperationLogModel{
			ProjectID:  projectID,
			ID:         record.ID,
			DocumentID: record.DocumentID,
			RecordJSON: string(recordJSON),
			CreatedAt:  domain.TimeFromString(record.CreatedAt),
		})
	}
	return normalized, models, nil
}
