package generation

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/server/internal/config"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/packages/server/internal/repository"
)

const generationTaskAttemptListLimit = 8
const submittingGenerationRetryDelay = 2 * time.Minute

// GenerationTaskService persists generation task state and attempts.
type GenerationTaskService struct {
	mu          sync.RWMutex
	repo        *repository.GenerationTaskRepository
	initErr     error
	idGenerator func(string) (string, error)
}

type generationTaskModel = domain.GenerationTaskModel
type generationTaskAttemptModel = domain.GenerationTaskAttemptModel
type generationConversationModel = domain.GenerationConversationModel

// NewGenerationTaskService returns a generation task service backed by settings DB.
func NewGenerationTaskService(dbPath string, idGenerator func(string) (string, error)) *GenerationTaskService {
	if dbPath == "" {
		dbPath = config.DefaultSettingsDBPath()
	}
	if idGenerator == nil {
		idGenerator = defaultGenerationTaskID
	}

	service := &GenerationTaskService{idGenerator: idGenerator}
	repos, err := repository.OpenSettingsRepositories(dbPath)
	if err != nil {
		service.initErr = err
		return service
	}

	service.repo = repos.GenerationTasks
	return service
}

// NewGenerationTaskServiceFromRepository returns a generation task service backed
// by an already constructed repository.
func NewGenerationTaskServiceFromRepository(repo *repository.GenerationTaskRepository, initErr error, idGenerator func(string) (string, error)) *GenerationTaskService {
	if idGenerator == nil {
		idGenerator = defaultGenerationTaskID
	}
	service := &GenerationTaskService{
		repo:        repo,
		initErr:     initErr,
		idGenerator: idGenerator,
	}
	if service.initErr == nil && service.repo == nil {
		service.initErr = errors.New("generation task repository is nil")
	}
	return service
}

// List returns generation tasks with attempt summaries.
func (service *GenerationTaskService) List(options ...repository.GenerationTaskListOptions) ([]GenerationTaskRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}

	service.mu.RLock()
	models, err := service.repo.ListGenerationTasks(options...)
	service.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	tasks, err := generationTaskRecordsFromModels(models)
	if err != nil {
		return nil, err
	}

	if err := service.attachAttemptSummaries(tasks); err != nil {
		return nil, err
	}

	return tasks, nil
}

// ListByConversation returns generation tasks in one conversation.
func (service *GenerationTaskService) ListByConversation(kind string, conversationID string, includeLegacyDefault bool, options ...repository.GenerationTaskListOptions) ([]GenerationTaskRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}

	service.mu.RLock()
	models, err := service.repo.ListGenerationTasksByConversation(kind, conversationID, includeLegacyDefault, options...)
	service.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	tasks, err := generationTaskRecordsFromModels(models)
	if err != nil {
		return nil, err
	}

	if err := service.attachAttemptSummaries(tasks); err != nil {
		return nil, err
	}

	return tasks, nil
}

// ListByProject returns generation tasks for one project.
func (service *GenerationTaskService) ListByProject(kind string, projectID string, options ...repository.GenerationTaskListOptions) ([]GenerationTaskRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}

	service.mu.RLock()
	models, err := service.repo.ListGenerationTasksByProject(kind, projectID, options...)
	service.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	tasks, err := generationTaskRecordsFromModels(models)
	if err != nil {
		return nil, err
	}

	if err := service.attachAttemptSummaries(tasks); err != nil {
		return nil, err
	}

	return tasks, nil
}

// ListPending returns pending video generation tasks.
func (service *GenerationTaskService) ListPending(limit int) ([]GenerationTaskRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}
	if limit <= 0 {
		limit = 10
	}

	service.mu.RLock()
	defer service.mu.RUnlock()

	models, err := service.repo.ListPendingGenerationTasks("video", []string{"submitting", "submitted", "running", "pending", "processing", "queued"}, limit*2)
	if err != nil {
		return nil, err
	}
	tasks, err := generationTaskRecordsFromModels(models)
	if err != nil {
		return nil, err
	}

	filtered := make([]GenerationTaskRecord, 0, min(limit, len(tasks)))
	now := time.Now().UTC()
	for _, task := range tasks {
		if strings.EqualFold(strings.TrimSpace(task.Status), "submitting") &&
			!isStaleSubmittingGenerationTask(task, now) {
			continue
		}
		filtered = append(filtered, task)
		if len(filtered) >= limit {
			break
		}
	}
	return filtered, nil
}

// Get returns one generation task by ID.
func (service *GenerationTaskService) Get(id string) (GenerationTaskRecord, bool, error) {
	if service.initErr != nil {
		return GenerationTaskRecord{}, false, service.initErr
	}

	service.mu.RLock()
	model, err := service.repo.GetGenerationTask(id)
	service.mu.RUnlock()
	if repository.IsRecordNotFound(err) {
		return GenerationTaskRecord{}, false, nil
	}
	if err != nil {
		return GenerationTaskRecord{}, false, err
	}
	task, err := generationTaskRecordFromModel(model)
	if err != nil {
		return GenerationTaskRecord{}, false, err
	}
	if err := service.attachAttemptSummary(&task); err != nil {
		return GenerationTaskRecord{}, false, err
	}

	return task, true, nil
}

// Upsert creates or updates a generation task.
func (service *GenerationTaskService) Upsert(task GenerationTaskRecord) error {
	if service.initErr != nil {
		return service.initErr
	}

	now := timestamp.NowRFC3339Nano()
	if strings.TrimSpace(task.CreatedAt) == "" {
		task.CreatedAt = now
	}
	task.UpdatedAt = now
	if task.ReferenceURLs == nil {
		task.ReferenceURLs = []string{}
	}
	if task.ReferenceAssetIDs == nil {
		task.ReferenceAssetIDs = []string{}
	}
	if task.Params == nil {
		task.Params = map[string]any{}
	}
	if task.Assets == nil {
		task.Assets = []GenerationAsset{}
	}

	referenceURLsJSON, err := json.Marshal(task.ReferenceURLs)
	if err != nil {
		return err
	}
	referenceAssetIDsJSON, err := json.Marshal(task.ReferenceAssetIDs)
	if err != nil {
		return err
	}
	paramsJSON, err := json.Marshal(task.Params)
	if err != nil {
		return err
	}
	assetsJSON, err := json.Marshal(task.Assets)
	if err != nil {
		return err
	}
	usageJSON, err := json.Marshal(task.Usage)
	if err != nil {
		return err
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	return service.repo.UpsertGenerationTask(generationTaskModel{
		ID:                    task.ID,
		ProviderTaskID:        task.ProviderTaskID,
		ConversationID:        task.ConversationID,
		ProjectID:             task.ProjectID,
		SectionID:             task.SectionID,
		CapabilityID:          task.CapabilityID,
		Kind:                  task.Kind,
		RouteID:               task.RouteID,
		FamilyID:              task.FamilyID,
		VersionID:             task.VersionID,
		Provider:              task.Provider,
		ModelID:               task.ModelID,
		Model:                 task.Model,
		Prompt:                task.Prompt,
		ReferenceURLsJSON:     string(referenceURLsJSON),
		ReferenceAssetIDsJSON: string(referenceAssetIDsJSON),
		ParamsJSON:            string(paramsJSON),
		Status:                strings.ToLower(strings.TrimSpace(task.Status)),
		Message:               task.Message,
		Text:                  task.Text,
		AssetsJSON:            string(assetsJSON),
		UsageJSON:             string(usageJSON),
		Error:                 task.Error,
		ErrorCode:             task.ErrorCode,
		ErrorType:             task.ErrorType,
		Retryable:             task.Retryable,
		CreatedAt:             task.CreatedAt,
		UpdatedAt:             task.UpdatedAt,
	})
}

func generationTaskListOptions(limit int, offset int) repository.GenerationTaskListOptions {
	return repository.GenerationTaskListOptions{Limit: limit, Offset: offset}
}

// UpsertConversation creates or updates a generation conversation.
func (service *GenerationTaskService) UpsertConversation(conversation GenerationConversationRecord) error {
	if service.initErr != nil {
		return service.initErr
	}

	now := timestamp.NowRFC3339Nano()
	if strings.TrimSpace(conversation.CreatedAt) == "" {
		conversation.CreatedAt = now
	}
	conversation.UpdatedAt = now

	service.mu.Lock()
	defer service.mu.Unlock()

	return service.repo.UpsertGenerationConversation(generationConversationModel{
		ID:        strings.TrimSpace(conversation.ID),
		ScopeID:   strings.TrimSpace(conversation.ScopeID),
		Kind:      strings.TrimSpace(conversation.Kind),
		Title:     strings.TrimSpace(conversation.Title),
		CreatedAt: conversation.CreatedAt,
		UpdatedAt: conversation.UpdatedAt,
	})
}

// ListConversations lists generation conversations.
func (service *GenerationTaskService) ListConversations(scopeID string, kind string) ([]GenerationConversationRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}

	service.mu.RLock()
	models, err := service.repo.ListGenerationConversations(scopeID, kind)
	service.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	conversations := make([]GenerationConversationRecord, 0, len(models))
	for _, model := range models {
		conversation := generationConversationRecordFromModel(model)
		if err := service.attachConversationSummary(&conversation); err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	return conversations, nil
}

// GetConversation returns one generation conversation.
func (service *GenerationTaskService) GetConversation(id string) (GenerationConversationRecord, bool, error) {
	if service.initErr != nil {
		return GenerationConversationRecord{}, false, service.initErr
	}

	service.mu.RLock()
	model, err := service.repo.GetGenerationConversation(id)
	service.mu.RUnlock()
	if repository.IsRecordNotFound(err) {
		return GenerationConversationRecord{}, false, nil
	}
	if err != nil {
		return GenerationConversationRecord{}, false, err
	}
	conversation := generationConversationRecordFromModel(model)
	if err := service.attachConversationSummary(&conversation); err != nil {
		return GenerationConversationRecord{}, false, err
	}
	return conversation, true, nil
}

// DeleteConversation removes one generation conversation and its tasks.
func (service *GenerationTaskService) DeleteConversation(id string) (bool, error) {
	if service.initErr != nil {
		return false, service.initErr
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	return service.repo.DeleteGenerationConversation(id)
}

func (service *GenerationTaskService) attachConversationSummary(conversation *GenerationConversationRecord) error {
	includeLegacyDefault := includeLegacyDefaultGenerationTasks(
		conversation.ScopeID,
		conversation.Kind,
		conversation.ID,
	)
	service.mu.RLock()
	defer service.mu.RUnlock()
	count, err := service.repo.CountGenerationTasksByConversation(
		conversation.Kind,
		conversation.ID,
		includeLegacyDefault,
	)
	if err != nil {
		return err
	}
	conversation.TaskCount = count

	latest, err := service.repo.LatestGenerationTaskByConversation(
		conversation.Kind,
		conversation.ID,
		includeLegacyDefault,
	)
	if repository.IsRecordNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	conversation.LatestPrompt = latest.Prompt
	conversation.UpdatedAt = maxString(conversation.UpdatedAt, latest.UpdatedAt)
	return nil
}

// RecordError records a generation task error.
func (service *GenerationTaskService) RecordError(id string, err error) error {
	if service.initErr != nil {
		return service.initErr
	}
	if err == nil {
		return nil
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	failure := GenerationFailureDetailsFromError(err)
	errorMessage := failure.Raw
	if errorMessage == "" {
		errorMessage = err.Error()
	}
	return service.repo.RecordGenerationTaskError(
		id,
		errorMessage,
		failure.Code,
		failure.Type,
		failure.Retryable,
		timestamp.NowRFC3339Nano(),
	)
}

// RecordAttempt records one generation task attempt.
func (service *GenerationTaskService) RecordAttempt(taskID string, action string, status string, message string, attemptErr error) error {
	if service.initErr != nil {
		return service.initErr
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil
	}

	id, err := service.idGenerator("attempt")
	if err != nil {
		return err
	}
	errorMessage := ""
	if attemptErr != nil {
		errorMessage = attemptErr.Error()
	}

	service.mu.Lock()
	defer service.mu.Unlock()
	return service.repo.CreateGenerationTaskAttempt(generationTaskAttemptModel{
		ID:        id,
		TaskID:    taskID,
		Action:    strings.TrimSpace(action),
		Status:    strings.TrimSpace(status),
		Message:   strings.TrimSpace(message),
		Error:     errorMessage,
		CreatedAt: timestamp.NowRFC3339Nano(),
	})
}

func (service *GenerationTaskService) listAttempts(taskID string, limit int) ([]GenerationTaskAttemptRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}
	if limit <= 0 {
		limit = generationTaskAttemptListLimit
	}

	service.mu.RLock()
	defer service.mu.RUnlock()

	models, err := service.repo.ListGenerationTaskAttempts(taskID, limit)
	if err != nil {
		return nil, err
	}

	return generationTaskAttemptRecordsFromModels(models), nil
}

func (service *GenerationTaskService) attachAttemptSummaries(tasks []GenerationTaskRecord) error {
	for index := range tasks {
		if err := service.attachAttemptSummary(&tasks[index]); err != nil {
			return err
		}
	}

	return nil
}

func (service *GenerationTaskService) attachAttemptSummary(task *GenerationTaskRecord) error {
	attempts, err := service.listAttempts(task.ID, generationTaskAttemptListLimit)
	if err != nil {
		return err
	}
	task.Attempts = attempts
	task.RetryCount, task.LastAttemptAt, err = service.attemptStats(task.ID)
	task.DurationMS = GenerationTaskDurationMS(*task)
	return err
}

func (service *GenerationTaskService) attemptStats(taskID string) (int, string, error) {
	if service.initErr != nil {
		return 0, "", service.initErr
	}

	service.mu.RLock()
	defer service.mu.RUnlock()

	models, err := service.repo.ListAllGenerationTaskAttempts(taskID)
	if err != nil {
		return 0, "", err
	}
	retryCount := 0
	lastAttemptAt := ""
	for _, model := range models {
		if model.Action == "retry" {
			retryCount++
		}
		if model.CreatedAt > lastAttemptAt {
			lastAttemptAt = model.CreatedAt
		}
	}
	return retryCount, lastAttemptAt, nil
}

// Delete removes a generation task.
func (service *GenerationTaskService) Delete(id string) (bool, error) {
	if service.initErr != nil {
		return false, service.initErr
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	return service.repo.DeleteGenerationTask(id)
}

func generationTaskRecordsFromModels(models []generationTaskModel) ([]GenerationTaskRecord, error) {
	tasks := make([]GenerationTaskRecord, 0, len(models))
	for _, model := range models {
		task, err := generationTaskRecordFromModel(model)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, nil
}

func generationTaskRecordFromModel(model generationTaskModel) (GenerationTaskRecord, error) {
	task := GenerationTaskRecord{
		ID:             model.ID,
		ProviderTaskID: model.ProviderTaskID,
		ConversationID: model.ConversationID,
		ProjectID:      model.ProjectID,
		SectionID:      model.SectionID,
		CapabilityID:   model.CapabilityID,
		Kind:           model.Kind,
		RouteID:        model.RouteID,
		FamilyID:       model.FamilyID,
		VersionID:      model.VersionID,
		Provider:       model.Provider,
		ModelID:        model.ModelID,
		Model:          model.Model,
		Prompt:         model.Prompt,
		Status:         model.Status,
		Message:        model.Message,
		Text:           model.Text,
		Error:          model.Error,
		ErrorCode:      model.ErrorCode,
		ErrorType:      model.ErrorType,
		Retryable:      model.Retryable,
		CreatedAt:      model.CreatedAt,
		UpdatedAt:      model.UpdatedAt,
	}

	if err := decodeGenerationTaskJSON(model.ReferenceURLsJSON, &task.ReferenceURLs); err != nil {
		return GenerationTaskRecord{}, err
	}
	if err := decodeGenerationTaskJSON(model.ReferenceAssetIDsJSON, &task.ReferenceAssetIDs); err != nil {
		return GenerationTaskRecord{}, err
	}
	if err := decodeGenerationTaskJSON(model.ParamsJSON, &task.Params); err != nil {
		return GenerationTaskRecord{}, err
	}
	if err := decodeGenerationTaskJSON(model.AssetsJSON, &task.Assets); err != nil {
		return GenerationTaskRecord{}, err
	}
	if err := decodeGenerationTaskJSON(model.UsageJSON, &task.Usage); err != nil {
		return GenerationTaskRecord{}, err
	}
	if task.ReferenceURLs == nil {
		task.ReferenceURLs = []string{}
	}
	if task.ReferenceAssetIDs == nil {
		task.ReferenceAssetIDs = []string{}
	}
	if task.Params == nil {
		task.Params = map[string]any{}
	}
	if task.Assets == nil {
		task.Assets = []GenerationAsset{}
	}

	return task, nil
}

func isStaleSubmittingGenerationTask(task GenerationTaskRecord, now time.Time) bool {
	updatedAt, err := timestamp.ParseRFC3339Nano(task.UpdatedAt)
	if err != nil {
		return true
	}
	return now.Sub(updatedAt) >= submittingGenerationRetryDelay
}

func generationConversationRecordFromModel(model generationConversationModel) GenerationConversationRecord {
	return GenerationConversationRecord{
		ID:        model.ID,
		ScopeID:   model.ScopeID,
		Kind:      model.Kind,
		Title:     model.Title,
		Default:   IsDefaultGenerationConversationID(model.ID),
		CreatedAt: model.CreatedAt,
		UpdatedAt: model.UpdatedAt,
	}
}

func generationTaskAttemptRecordsFromModels(models []generationTaskAttemptModel) []GenerationTaskAttemptRecord {
	attempts := make([]GenerationTaskAttemptRecord, 0, len(models))
	for _, model := range models {
		attempts = append(attempts, GenerationTaskAttemptRecord{
			ID:        model.ID,
			TaskID:    model.TaskID,
			Action:    model.Action,
			Status:    model.Status,
			Message:   model.Message,
			Error:     model.Error,
			CreatedAt: model.CreatedAt,
		})
	}
	return attempts
}

func maxString(left string, right string) string {
	if right > left {
		return right
	}
	return left
}

// GenerationTaskDurationMS returns a generation task duration in milliseconds.
func GenerationTaskDurationMS(task GenerationTaskRecord) int64 {
	start, err := timestamp.ParseRFC3339Nano(task.CreatedAt)
	if err != nil {
		return 0
	}

	end := time.Now().UTC()
	if IsTerminalGenerationTaskStatus(task.Status) {
		if parsed, err := timestamp.ParseRFC3339Nano(task.UpdatedAt); err == nil {
			end = parsed
		}
	}
	if end.Before(start) {
		return 0
	}

	return end.Sub(start).Milliseconds()
}

// IsTerminalGenerationTaskStatus reports whether a generation task status is terminal.
func IsTerminalGenerationTaskStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "failed", "cancelled", "canceled":
		return true
	default:
		return false
	}
}

func defaultGenerationTaskID(prefix string) (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(bytes[:]), nil
}

func decodeGenerationTaskJSON[T any](value string, target *T) error {
	if strings.TrimSpace(value) == "" {
		value = "null"
	}
	if err := json.Unmarshal([]byte(value), target); err != nil {
		return fmt.Errorf("decoding generation task json: %w", err)
	}

	return nil
}
