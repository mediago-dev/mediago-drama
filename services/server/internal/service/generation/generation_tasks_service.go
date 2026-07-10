package generation

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	serviceshared "github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const generationTaskAttemptListLimit = 8
const submittingGenerationRetryDelay = 2 * time.Minute

// maxBackgroundImageGenerationAge caps how long an image task handed off to background
// polling may stay pending before it is treated as timed out. It covers the whole wait
// since submission (inline poll budget included), so the provider gets ample time to
// return a slow result without letting a lost task spin forever.
const maxBackgroundImageGenerationAge = 15 * time.Minute

// GenerationTaskService persists generation task state and attempts.
type GenerationTaskService struct {
	mu          sync.RWMutex
	repo        *repository.GenerationTaskRepository
	initErr     error
	idGenerator func(string) (string, error)
	// onTaskCompleted fires exactly once per not-completed→completed status
	// transition persisted by upsertTask, after the service mutex is released.
	// It anchors "the task finished" at the write that makes it true — poll
	// re-upserts of an already-completed task do not re-fire.
	onTaskCompleted func(GenerationTaskRecord)
}

// SetTaskCompletionListener installs the completion-transition callback.
func (service *GenerationTaskService) SetTaskCompletionListener(listener func(GenerationTaskRecord)) {
	if service == nil {
		return
	}
	service.onTaskCompleted = listener
}

type generationTaskModel = domain.GenerationTaskModel
type generationTaskAttemptModel = domain.GenerationTaskAttemptModel
type generationConversationModel = domain.GenerationConversationModel
type projectSelectedAssetModel = domain.ProjectSelectedAssetModel

// NewGenerationTaskService returns a generation task service backed by the workspace DB.
func NewGenerationTaskService(dbPath string, idGenerator func(string) (string, error)) *GenerationTaskService {
	if dbPath == "" {
		dbPath = serviceshared.WorkspacePathsFor("").DatabasePath()
	}
	if idGenerator == nil {
		idGenerator = defaultGenerationTaskID
	}

	service := &GenerationTaskService{idGenerator: idGenerator}
	repo, err := repository.NewGenerationTaskRepository(dbPath)
	if err != nil {
		service.initErr = err
		return service
	}

	service.repo = repo
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

// ListProjectResourceAssets returns selected project resources from the unified selection table.
func (service *GenerationTaskService) ListProjectResourceAssets(projectID string) ([]SelectedGenerationAssetRecord, error) {
	return service.ListProjectSelectedAssets(projectID)
}

// CountGeneratedAssetsBySection returns stored asset counts per document section for a project,
// filtered to the given generation kind (e.g. "video" or "image").
func (service *GenerationTaskService) CountGeneratedAssetsBySection(projectID string, kind string) ([]repository.GenerationSectionAssetCount, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}

	service.mu.RLock()
	counts, err := service.repo.CountGeneratedAssetsByProjectSection(projectID, kind)
	service.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	return counts, nil
}

// ListProjectSelectedAssets returns project-selected assets from the dedicated selection table.
func (service *GenerationTaskService) ListProjectSelectedAssets(projectID string) ([]SelectedGenerationAssetRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}

	service.mu.RLock()
	models, err := service.repo.ListProjectSelectedAssets(projectID)
	service.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	assets := make([]SelectedGenerationAssetRecord, 0, len(models))
	for _, model := range models {
		assets = append(assets, selectedGenerationAssetRecordFromModel(model))
	}
	return assets, nil
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

	videoModels, err := service.repo.ListPendingGenerationTasks("video", []string{"submitting", "submitted", "running", "pending", "processing", "queued"}, limit*2)
	if err != nil {
		return nil, err
	}
	videoTasks, err := generationTaskRecordsFromModels(videoModels)
	if err != nil {
		return nil, err
	}

	// Image tasks are only polled once the inline generation handed them off — status
	// "submitted" with a provider task id — never while they are still running inline.
	imageModels, err := service.repo.ListPendingGenerationTasks("image", []string{"submitted"}, limit*2)
	if err != nil {
		return nil, err
	}
	imageTasks, err := generationTaskRecordsFromModels(imageModels)
	if err != nil {
		return nil, err
	}

	filtered := make([]GenerationTaskRecord, 0, min(limit, len(videoTasks)+len(imageTasks)))
	now := time.Now().UTC()
	for _, task := range videoTasks {
		if len(filtered) >= limit {
			return filtered, nil
		}
		if strings.EqualFold(strings.TrimSpace(task.Status), "submitting") &&
			!isStaleSubmittingGenerationTask(task, now) {
			continue
		}
		filtered = append(filtered, task)
	}
	for _, task := range imageTasks {
		if len(filtered) >= limit {
			break
		}
		if GenerationTaskProviderPollID(task) == "" {
			continue
		}
		filtered = append(filtered, task)
	}
	return filtered, nil
}

// ListVideoTasksByStatusesAndRoutes returns video tasks matching any status and route.
func (service *GenerationTaskService) ListVideoTasksByStatusesAndRoutes(statuses []string, routeIDs []string, excludeID string, limit int) ([]GenerationTaskRecord, error) {
	if service.initErr != nil {
		return nil, service.initErr
	}

	service.mu.RLock()
	models, err := service.repo.ListGenerationTasksByKindRoutesAndStatuses("video", routeIDs, statuses, limit)
	service.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	tasks, err := generationTaskRecordsFromModels(models)
	if err != nil {
		return nil, err
	}

	excludeID = strings.TrimSpace(excludeID)
	filtered := make([]GenerationTaskRecord, 0, len(tasks))
	for _, task := range tasks {
		if excludeID != "" && strings.TrimSpace(task.ID) == excludeID {
			continue
		}
		filtered = append(filtered, task)
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

// DeleteAsset removes one generated asset from a generation task.
func (service *GenerationTaskService) DeleteAsset(id string, assetIndex int) (GenerationTaskRecord, bool, error) {
	if service.initErr != nil {
		return GenerationTaskRecord{}, false, service.initErr
	}
	if assetIndex < 0 {
		return GenerationTaskRecord{}, false, nil
	}

	task, updated, err := service.deleteAssetRecord(id, assetIndex)
	if err != nil || !updated {
		return GenerationTaskRecord{}, updated, err
	}
	if err := service.attachAttemptSummary(&task); err != nil {
		return GenerationTaskRecord{}, false, err
	}

	return task, true, nil
}

// UpdateAsset updates user-facing metadata for one generated asset on a task.
func (service *GenerationTaskService) UpdateAsset(id string, assetIndex int, patch UpdateGenerationTaskAssetRequest) (GenerationTaskRecord, bool, error) {
	if service.initErr != nil {
		return GenerationTaskRecord{}, false, service.initErr
	}
	if assetIndex < 0 {
		return GenerationTaskRecord{}, false, nil
	}

	task, updated, err := service.updateAssetRecord(id, assetIndex, patch)
	if err != nil || !updated {
		return GenerationTaskRecord{}, updated, err
	}
	if err := service.attachAttemptSummary(&task); err != nil {
		return GenerationTaskRecord{}, false, err
	}

	return task, true, nil
}

// UpsertSelectedAsset stores one project asset selection independent from generation history.
func (service *GenerationTaskService) UpsertSelectedAsset(projectID string, request UpdateSelectedGenerationAssetRequest) (SelectedGenerationAssetRecord, bool, error) {
	if service.initErr != nil {
		return SelectedGenerationAssetRecord{}, false, service.initErr
	}

	model, ok, err := service.upsertSelectedAssetRecord(projectID, request)
	if err != nil || !ok {
		return SelectedGenerationAssetRecord{}, ok, err
	}
	return selectedGenerationAssetRecordFromModel(model), true, nil
}

// DeleteSelectedAsset removes one project asset selection and mirrors task selection when applicable.
func (service *GenerationTaskService) DeleteSelectedAsset(projectID string, id string) (bool, error) {
	if service.initErr != nil {
		return false, service.initErr
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	model, err := service.repo.GetProjectSelectedAsset(id)
	if repository.IsRecordNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if domain.CleanProjectID(projectID) != "" && domain.CleanProjectID(model.ProjectID) != domain.CleanProjectID(projectID) {
		return false, nil
	}
	deleted, err := service.repo.DeleteProjectSelectedAsset(model.ID)
	if err != nil || !deleted {
		return deleted, err
	}
	sourceTaskID := domain.StringValue(model.SourceTaskID)
	if sourceTaskID != "" && model.SourceSlotIndex >= 0 {
		if err := service.setTaskAssetSelectedLocked(sourceTaskID, model.SourceSlotIndex, false, "", ""); err != nil {
			return true, err
		}
	}
	return true, nil
}

// DeleteSelectedAssetByRequest removes one project asset selection by the same fields used to select it.
func (service *GenerationTaskService) DeleteSelectedAssetByRequest(projectID string, request UpdateSelectedGenerationAssetRequest) (bool, error) {
	if service.initErr != nil {
		return false, service.initErr
	}

	service.mu.Lock()
	defer service.mu.Unlock()

	model := projectSelectedAssetModelFromRequest(projectID, request)
	taskID := strings.TrimSpace(request.SourceTaskID)
	if taskID == "" {
		taskID = strings.TrimSpace(request.TaskID)
	}
	assetIndex := selectedAssetRequestSourceIndex(request)
	if taskID != "" && assetIndex >= 0 {
		if err := service.hydrateProjectSelectedAssetModelFromTaskLocked(&model, taskID, assetIndex); err != nil {
			return false, err
		}
	}
	model.ID = projectSelectedAssetID(model)

	deleted, err := service.repo.DeleteProjectSelectedAsset(model.ID)
	if err != nil || !deleted {
		if err != nil {
			return deleted, err
		}
		deleted, err = service.repo.DeleteProjectSelectedAssetByTaskSlot(model.ProjectID, model.ResourceType, taskID, assetIndex)
		if err != nil || !deleted {
			return deleted, err
		}
	}
	if taskID != "" && assetIndex >= 0 {
		if err := service.setTaskAssetSelectedLocked(taskID, assetIndex, false, "", ""); err != nil {
			return true, err
		}
	}
	return true, nil
}

func (service *GenerationTaskService) hydrateProjectSelectedAssetModelFromTaskLocked(model *domain.ProjectSelectedAssetModel, taskID string, assetIndex int) error {
	if model == nil || strings.TrimSpace(taskID) == "" || assetIndex < 0 {
		return nil
	}
	taskModel, err := service.repo.GetGenerationTask(taskID)
	if repository.IsRecordNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	task, err := generationTaskRecordFromModel(taskModel)
	if err != nil {
		return err
	}
	if assetIndex >= len(task.Assets) || generationDeletedAssetSlotSet(task.DeletedAssetSlots)[assetIndex] {
		return nil
	}
	asset := task.Assets[assetIndex]
	if strings.TrimSpace(model.ProjectID) == "" {
		model.ProjectID = GenerationProjectIDForRequest(task.ProjectID, "")
	}
	model.SourceTaskID = domain.StringPtr(task.ID)
	model.SourceSlotIndex = assetIndex
	if domain.StringValue(model.SourceType) == "" {
		model.SourceType = domain.StringPtr("generated")
	}
	if strings.TrimSpace(model.AssetID) == "" {
		model.AssetID = firstNonEmpty(asset.AssetID, libraryAssetIDFromGenerationAssetURL(asset.URL))
	}
	if domain.StringValue(model.ResourceTitle) == "" {
		model.ResourceTitle = domain.StringPtr(asset.Title)
	}
	return nil
}

func (service *GenerationTaskService) deleteAssetRecord(id string, assetIndex int) (GenerationTaskRecord, bool, error) {
	service.mu.Lock()
	defer service.mu.Unlock()

	model, err := service.repo.GetGenerationTask(id)
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
	if _, ok := generationAssetAtSlot(task, assetIndex); !ok {
		return GenerationTaskRecord{}, false, nil
	}
	if err := service.deleteProjectSelectedAssetRowForTaskAssetLocked(task, assetIndex); err != nil {
		return task, true, err
	}
	task.UpdatedAt = timestamp.NowRFC3339Nano()

	deleted, err := service.repo.DeleteGenerationTaskAssetSlot(id, assetIndex)
	if err != nil || !deleted {
		return task, deleted, err
	}
	updated, err := service.repo.UpdateGenerationTaskAssets(id, task.CapabilityID, task.UpdatedAt)
	if err != nil || !updated {
		return task, updated, err
	}
	model, err = service.repo.GetGenerationTask(id)
	if err != nil {
		return task, true, err
	}
	task, err = generationTaskRecordFromModel(model)
	if err != nil {
		return GenerationTaskRecord{}, false, err
	}
	return task, true, nil
}

func (service *GenerationTaskService) upsertSelectedAssetRecord(projectID string, request UpdateSelectedGenerationAssetRequest) (projectSelectedAssetModel, bool, error) {
	service.mu.Lock()
	defer service.mu.Unlock()

	model := projectSelectedAssetModelFromRequest(projectID, request)
	resourceType := selectedGenerationResourceType(model.ResourceType)
	if domain.CleanProjectID(model.ProjectID) == "" || resourceType == "" {
		return projectSelectedAssetModel{}, false, nil
	}
	model.ProjectID = domain.CleanProjectID(model.ProjectID)
	model.ResourceType = resourceType
	assetKind := strings.TrimSpace(request.Kind)
	taskID := strings.TrimSpace(request.SourceTaskID)
	if taskID == "" {
		taskID = strings.TrimSpace(request.TaskID)
	}
	assetIndex := selectedAssetRequestSourceIndex(request)
	resolvedTaskSource := false
	if taskID != "" && assetIndex >= 0 {
		taskModel, err := service.repo.GetGenerationTask(taskID)
		if repository.IsRecordNotFound(err) {
			taskModel = domain.GenerationTaskModel{}
			err = nil
		}
		if err != nil {
			return projectSelectedAssetModel{}, false, err
		}
		if strings.TrimSpace(taskModel.ID) != "" {
			task, err := generationTaskRecordFromModel(taskModel)
			if err != nil {
				return projectSelectedAssetModel{}, false, err
			}
			assetSliceIndex, ok := generationAssetSliceIndexForSlot(task, assetIndex)
			if !ok || generationDeletedAssetSlotSet(task.DeletedAssetSlots)[assetIndex] {
				return projectSelectedAssetModel{}, false, nil
			}
			asset := task.Assets[assetSliceIndex]
			assetKind = strings.TrimSpace(asset.Kind)
			title := domain.StringValue(model.ResourceTitle)
			if title == "" {
				title = strings.TrimSpace(asset.Title)
			}
			task.Assets[assetSliceIndex].Selected = true
			if title != "" {
				task.Assets[assetSliceIndex].Title = title
			}
			task.ResourceType = resourceType
			task.UpdatedAt = timestamp.NowRFC3339Nano()
			updated, err := service.repo.UpdateGenerationTaskAssets(task.ID, task.ResourceType, task.UpdatedAt)
			if err != nil || !updated {
				return projectSelectedAssetModel{}, updated, err
			}
			if err := service.syncNormalizedTaskAssetRowsLocked(task); err != nil {
				return projectSelectedAssetModel{}, true, err
			}

			asset = task.Assets[assetSliceIndex]
			model.SourceTaskID = domain.StringPtr(task.ID)
			model.SourceSlotIndex = assetIndex
			sourceDocumentID, resourceID := selectedAssetResourceFromTask(task)
			if domain.StringValue(model.SourceDocumentID) == "" && sourceDocumentID != "" {
				model.SourceDocumentID = domain.StringPtr(sourceDocumentID)
			}
			if domain.StringValue(model.ResourceID) == "" && resourceID != "" {
				model.ResourceID = domain.StringPtr(resourceID)
			}
			if domain.StringValue(model.SourceType) == "" {
				model.SourceType = domain.StringPtr("generated")
			}
			if strings.TrimSpace(model.ProjectID) == "" {
				model.ProjectID = GenerationProjectIDForRequest(task.ProjectID, "")
			}
			if strings.TrimSpace(model.AssetID) == "" {
				model.AssetID = firstNonEmpty(asset.AssetID, libraryAssetIDFromGenerationAssetURL(asset.URL))
			}
			if domain.StringValue(model.ResourceTitle) == "" {
				model.ResourceTitle = domain.StringPtr(asset.Title)
			}
			if model.CreatedAt.IsZero() {
				model.CreatedAt = domain.TimeFromString(task.CreatedAt)
			}
			resolvedTaskSource = true
		}
	}
	model = normalizeProjectSelectedAssetModelForUpsert(model)
	if !resolvedTaskSource && taskID != "" {
		model.SourceTaskID = nil
		model.SourceSlotIndex = -1
		if domain.StringValue(model.SourceType) == "generated" {
			model.SourceType = domain.StringPtr("uploaded")
		}
	}
	if !resolvedTaskSource && !projectSelectedAssetModelHasDirectPayload(model) {
		return projectSelectedAssetModel{}, false, nil
	}
	if strings.TrimSpace(model.AssetID) == "" {
		return projectSelectedAssetModel{}, false, nil
	}
	model.ID = projectSelectedAssetID(model)
	now := timestamp.NowRFC3339Nano()
	if model.CreatedAt.IsZero() {
		model.CreatedAt = domain.TimeFromString(now)
	}
	model.UpdatedAt = domain.TimeFromString(now)
	if err := service.replaceResourceSelectionLocked(model, assetKind); err != nil {
		return projectSelectedAssetModel{}, false, err
	}
	persisted, err := service.repo.GetProjectSelectedAsset(model.ID)
	if err != nil {
		return projectSelectedAssetModel{}, false, err
	}
	return persisted, true, nil
}

func (service *GenerationTaskService) clearProjectSelectedAssetRowsForResourceKindLocked(model domain.ProjectSelectedAssetModel, kind string) error {
	kind = strings.TrimSpace(kind)
	resourceID := domain.StringValue(model.ResourceID)
	if service.repo == nil ||
		domain.CleanProjectID(model.ProjectID) == "" ||
		strings.TrimSpace(model.ResourceType) == "" ||
		strings.TrimSpace(resourceID) == "" ||
		!isSelectableGenerationAssetKind(kind) {
		return nil
	}

	existingRows, err := service.repo.ListProjectSelectedAssets(model.ProjectID)
	if err != nil {
		return err
	}
	for _, existing := range existingRows {
		if strings.TrimSpace(existing.ID) == strings.TrimSpace(model.ID) {
			continue
		}
		if !sameProjectSelectedResourceKind(existing, model, kind) {
			continue
		}
		if _, err := service.repo.DeleteProjectSelectedAsset(existing.ID); err != nil {
			return err
		}
		sourceTaskID := domain.StringValue(existing.SourceTaskID)
		if sourceTaskID != "" && existing.SourceSlotIndex >= 0 {
			if err := service.setTaskAssetSelectedLocked(sourceTaskID, existing.SourceSlotIndex, false, "", ""); err != nil {
				return err
			}
		}
	}
	return nil
}

func sameProjectSelectedResourceKind(existing domain.ProjectSelectedAssetModel, next domain.ProjectSelectedAssetModel, kind string) bool {
	if domain.CleanProjectID(existing.ProjectID) != domain.CleanProjectID(next.ProjectID) ||
		strings.TrimSpace(existing.ResourceType) != strings.TrimSpace(next.ResourceType) ||
		domain.StringValue(existing.ResourceID) != domain.StringValue(next.ResourceID) ||
		strings.TrimSpace(existing.Asset.Kind) != strings.TrimSpace(kind) {
		return false
	}

	nextDocumentID := domain.StringValue(next.SourceDocumentID)
	if nextDocumentID == "" {
		return true
	}
	existingDocumentID := domain.StringValue(existing.SourceDocumentID)
	return existingDocumentID == "" || existingDocumentID == nextDocumentID
}

func (service *GenerationTaskService) setTaskAssetSelectedLocked(taskID string, assetIndex int, selected bool, title string, resourceType string) error {
	if assetIndex < 0 {
		return nil
	}
	model, err := service.repo.GetGenerationTask(taskID)
	if repository.IsRecordNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	task, err := generationTaskRecordFromModel(model)
	if err != nil {
		return err
	}
	assetSliceIndex, ok := generationAssetSliceIndexForSlot(task, assetIndex)
	if !ok || generationDeletedAssetSlotSet(task.DeletedAssetSlots)[assetIndex] {
		return nil
	}
	task.Assets[assetSliceIndex].Selected = selected
	if title = strings.TrimSpace(title); title != "" {
		task.Assets[assetSliceIndex].Title = title
	}
	if resourceType = selectedGenerationResourceType(resourceType); resourceType != "" {
		task.ResourceType = resourceType
	}
	task.UpdatedAt = timestamp.NowRFC3339Nano()
	updated, err := service.repo.UpdateGenerationTaskAssets(task.ID, task.ResourceType, task.UpdatedAt)
	if err != nil || !updated {
		return err
	}
	return service.syncNormalizedTaskAssetRowsLocked(task)
}

func (service *GenerationTaskService) updateAssetRecord(id string, assetIndex int, patch UpdateGenerationTaskAssetRequest) (GenerationTaskRecord, bool, error) {
	service.mu.Lock()
	defer service.mu.Unlock()

	model, err := service.repo.GetGenerationTask(id)
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
	assetSliceIndex, ok := generationAssetSliceIndexForSlot(task, assetIndex)
	if !ok || generationDeletedAssetSlotSet(task.DeletedAssetSlots)[assetIndex] {
		return GenerationTaskRecord{}, false, nil
	}

	if patch.Selected != nil {
		task.Assets[assetSliceIndex].Selected = *patch.Selected
	}
	if patch.Title != nil {
		task.Assets[assetSliceIndex].Title = strings.TrimSpace(*patch.Title)
	}
	if resourceType := selectedGenerationResourceType(patch.ResourceType); resourceType != "" {
		task.ResourceType = resourceType
	}
	task.UpdatedAt = timestamp.NowRFC3339Nano()

	updated, err := service.repo.UpdateGenerationTaskAssets(id, task.ResourceType, task.UpdatedAt)
	if err != nil || !updated {
		return task, updated, err
	}
	if err := service.syncNormalizedTaskAssetRowsLocked(task); err != nil {
		return task, true, err
	}
	if err := service.syncProjectSelectedAssetRowForTaskAssetLocked(task, assetIndex); err != nil {
		return task, true, err
	}
	return task, true, nil
}

// Upsert creates or updates a generation task.
func (service *GenerationTaskService) Upsert(task GenerationTaskRecord) error {
	_, err := service.upsertTask(task, false)
	return err
}

// UpsertExisting writes a task only when it still exists, reporting whether it did. Background
// workers (submit/poll/progress/handoff) use this so a task the user deleted mid-generation is
// not resurrected by a late write from the in-flight goroutine.
func (service *GenerationTaskService) UpsertExisting(task GenerationTaskRecord) (bool, error) {
	return service.upsertTask(task, true)
}

func (service *GenerationTaskService) upsertTask(task GenerationTaskRecord, requireExisting bool) (bool, error) {
	if service.initErr != nil {
		return false, service.initErr
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

	paramsJSON, err := json.Marshal(task.Params)
	if err != nil {
		return false, err
	}

	completedTransition := false
	// Registered before the lock's deferred unlock, so it runs after the
	// mutex is released (LIFO) — the listener may read back through the
	// service or publish events without re-entering the lock.
	defer func() {
		if completedTransition && service.onTaskCompleted != nil {
			service.onTaskCompleted(task)
		}
	}()
	service.mu.Lock()
	defer service.mu.Unlock()

	if requireExisting {
		exists, err := service.repo.GenerationTaskExists(task.ID)
		if err != nil {
			return false, err
		}
		if !exists {
			return false, nil
		}
	}
	previousStatus, statusErr := service.repo.GetGenerationTaskStatus(task.ID)
	if statusErr != nil && !repository.IsRecordNotFound(statusErr) {
		return false, statusErr
	}

	if err := service.ensureTaskConversationLocked(task); err != nil {
		return false, err
	}
	if err := service.applyDefaultSelectedAssetLocked(&task); err != nil {
		return false, err
	}
	if err := service.repo.UpsertGenerationTask(generationTaskModel{
		ID:              task.ID,
		ProviderTaskID:  task.ProviderTaskID,
		ConversationID:  domain.StringPtr(task.ConversationID),
		ProjectID:       domain.StringPtr(GenerationProjectIDForRequest(task.ProjectID, "")),
		DocumentID:      domain.StringPtr(task.DocumentID),
		SectionID:       domain.StringPtr(task.SectionID),
		CapabilityID:    domain.StringPtr(task.CapabilityID),
		ResourceType:    domain.StringPtr(task.ResourceType),
		Kind:            task.Kind,
		RouteID:         task.RouteID,
		FamilyID:        task.FamilyID,
		VersionID:       task.VersionID,
		Provider:        task.Provider,
		ModelID:         task.ModelID,
		Model:           task.Model,
		Prompt:          task.Prompt,
		ParamsJSON:      string(paramsJSON),
		Status:          strings.ToLower(strings.TrimSpace(task.Status)),
		Message:         task.Message,
		Text:            task.Text,
		InputTokens:     task.Usage.InputTokens,
		OutputTokens:    task.Usage.OutputTokens,
		TotalTokens:     task.Usage.TotalTokens,
		ReasoningTokens: task.Usage.ReasoningTokens,
		CachedTokens:    task.Usage.CachedTokens,
		Error:           task.Error,
		ErrorCode:       task.ErrorCode,
		ErrorType:       task.ErrorType,
		Retryable:       task.Retryable,
		CreatedAt:       domain.TimeFromString(task.CreatedAt),
		UpdatedAt:       domain.TimeFromString(task.UpdatedAt),
	}); err != nil {
		return false, err
	}
	if err := service.syncNormalizedTaskReferenceRowsLocked(task); err != nil {
		return false, err
	}
	if err := service.syncNormalizedTaskAssetRowsLocked(task); err != nil {
		return false, err
	}
	if err := service.upsertProjectSelectedAssetRowsLocked(projectSelectedAssetModelsFromRecord(task)); err != nil {
		return false, err
	}
	completedTransition = !isCompletedGenerationTaskStatus(previousStatus) &&
		isCompletedGenerationTaskStatus(task.Status)
	return true, nil
}

func (service *GenerationTaskService) applyDefaultSelectedAssetLocked(task *GenerationTaskRecord) error {
	if service.repo == nil || task == nil || !shouldDefaultSelectGenerationAsset(*task) {
		return nil
	}

	assetIndex := firstDefaultSelectableGenerationAssetIndex(*task)
	if assetIndex < 0 {
		return nil
	}

	// 统一「最新一次生成的第一张即已选」：每次生成完成先清掉该 section+kind 的旧选中
	// （复用手动选中路径的替换逻辑，含把旧任务的 asset.Selected 回置），再选本次第一张。
	clearModel := domain.ProjectSelectedAssetModel{
		ProjectID:        GenerationProjectIDForRequest(task.ProjectID, ""),
		ResourceType:     generationTaskResourceType(*task),
		ResourceID:       domain.StringPtr(strings.TrimSpace(task.SectionID)),
		SourceDocumentID: domain.StringPtr(strings.TrimSpace(task.DocumentID)),
	}
	if err := service.clearProjectSelectedAssetRowsForResourceKindLocked(clearModel, task.Kind); err != nil {
		return err
	}
	task.Assets[assetIndex].Selected = true
	return nil
}

func shouldDefaultSelectGenerationAsset(task GenerationTaskRecord) bool {
	// 每次成功生成都要把选中切到本次结果，故不再因「该资源已有选中」而跳过。
	if !isCompletedGenerationTaskStatus(task.Status) ||
		!isSelectableGenerationAssetKind(task.Kind) ||
		strings.TrimSpace(task.RouteID) == importedMediaGenerationRouteID ||
		GenerationProjectIDForRequest(task.ProjectID, "") == "" ||
		generationTaskResourceType(task) == "" ||
		strings.TrimSpace(task.DocumentID) == "" ||
		strings.TrimSpace(task.SectionID) == "" {
		return false
	}
	return true
}

func isCompletedGenerationTaskStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "succeeded", "success":
		return true
	default:
		return false
	}
}

func firstDefaultSelectableGenerationAssetIndex(task GenerationTaskRecord) int {
	kind := strings.TrimSpace(task.Kind)
	deletedSlots := generationDeletedAssetSlotSet(task.DeletedAssetSlots)
	for index, asset := range task.Assets {
		slotIndex := assetSlotIndex(index, asset)
		if deletedSlots[slotIndex] ||
			strings.TrimSpace(asset.Kind) != kind ||
			firstNonEmpty(asset.AssetID, libraryAssetIDFromGenerationAssetURL(asset.URL)) == "" {
			continue
		}
		return index
	}
	return -1
}

func isSelectableGenerationAssetKind(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "audio", "image", "video":
		return true
	default:
		return false
	}
}

func (service *GenerationTaskService) ensureTaskConversationLocked(task GenerationTaskRecord) error {
	conversationID := strings.TrimSpace(task.ConversationID)
	if service.repo == nil || conversationID == "" {
		return nil
	}
	if _, err := service.repo.GetGenerationConversation(conversationID); err == nil {
		return nil
	} else if !repository.IsRecordNotFound(err) {
		return err
	}
	now := timestamp.NowRFC3339Nano()
	scopeID := generationConversationScopeIDForTask(task)
	return service.repo.UpsertGenerationConversation(generationConversationModel{
		ID:        conversationID,
		ScopeID:   scopeID,
		Kind:      strings.TrimSpace(task.Kind),
		Title:     "",
		CreatedAt: domain.TimeFromString(now),
		UpdatedAt: domain.TimeFromString(now),
	})
}

func generationConversationScopeIDForTask(task GenerationTaskRecord) string {
	kind := strings.TrimSpace(task.Kind)
	conversationID := strings.TrimSpace(task.ConversationID)
	if scopeID := defaultConversationScopeIDFromID(conversationID, kind); scopeID != "" {
		return NormalizeGenerationConversationScopeID(scopeID)
	}
	if projectID := domain.CleanProjectID(task.ProjectID); projectID != "" {
		return generationProjectScopePrefix + projectID
	}
	return defaultGenerationConversationScopeID
}

func defaultConversationScopeIDFromID(conversationID string, kind string) string {
	conversationID = strings.TrimSpace(conversationID)
	kindPart := normalizeGenerationConversationIDPart(kind)
	if kindPart == "" {
		return ""
	}
	const prefix = "conversation-"
	suffix := "-" + kindPart + "-default"
	if !strings.HasPrefix(conversationID, prefix) || !strings.HasSuffix(conversationID, suffix) {
		return ""
	}
	return strings.TrimSuffix(strings.TrimPrefix(conversationID, prefix), suffix)
}

func (service *GenerationTaskService) syncNormalizedTaskReferenceRowsLocked(task GenerationTaskRecord) error {
	if service.repo == nil {
		return nil
	}
	if err := service.repo.ReplaceGenerationTaskReferenceRows(task.ID, generationTaskReferenceModelsFromRecord(task)); err != nil {
		return err
	}
	return nil
}

func (service *GenerationTaskService) syncNormalizedTaskAssetRowsLocked(task GenerationTaskRecord) error {
	if service.repo == nil {
		return nil
	}
	if err := service.repo.ReplaceGenerationTaskAssetRows(task.ID, generationTaskAssetModelsFromRecord(task)); err != nil {
		return err
	}
	return nil
}

// upsertProjectSelectedAssetRowsLocked bulk-syncs a task's selected-asset rows
// on every task upsert. It intentionally does NOT go through
// replaceResourceSelectionLocked: the single-choice clear already ran in
// applyDefaultSelectedAssetLocked for the default-select case, and running the
// clear here would add a full list scan to every poll write and trim legacy
// multi-select tasks destructively. New selection entry points must use
// replaceResourceSelectionLocked, not this writer.
func (service *GenerationTaskService) upsertProjectSelectedAssetRowsLocked(rows []domain.ProjectSelectedAssetModel) error {
	for _, row := range rows {
		if err := service.repo.UpsertProjectSelectedAsset(row); err != nil {
			return err
		}
	}
	return nil
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
		CreatedAt: domain.TimeFromString(conversation.CreatedAt),
		UpdatedAt: domain.TimeFromString(conversation.UpdatedAt),
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
	conversation.UpdatedAt = maxString(conversation.UpdatedAt, domain.StringFromTime(latest.UpdatedAt))
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
	errorMessage := generationSafeFailureError(failure)
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
		CreatedAt: domain.TimeFromString(timestamp.NowRFC3339Nano()),
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
		createdAt := domain.StringFromTime(model.CreatedAt)
		if createdAt > lastAttemptAt {
			lastAttemptAt = createdAt
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
		ConversationID: domain.StringValue(model.ConversationID),
		ProjectID:      domain.StringValue(model.ProjectID),
		DocumentID:     domain.StringValue(model.DocumentID),
		SectionID:      domain.StringValue(model.SectionID),
		CapabilityID:   domain.StringValue(model.CapabilityID),
		ResourceType:   domain.StringValue(model.ResourceType),
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
		CreatedAt:      domain.StringFromTime(model.CreatedAt),
		UpdatedAt:      domain.StringFromTime(model.UpdatedAt),
		Usage: GenerationUsage{
			InputTokens:     model.InputTokens,
			OutputTokens:    model.OutputTokens,
			TotalTokens:     model.TotalTokens,
			ReasoningTokens: model.ReasoningTokens,
			CachedTokens:    model.CachedTokens,
		},
	}

	if err := decodeGenerationTaskJSON(model.ParamsJSON, &task.Params); err != nil {
		return GenerationTaskRecord{}, err
	}
	task.ReferenceURLs, task.ReferenceAssetIDs = generationTaskReferencesFromModels(model.References)
	if task.Params == nil {
		task.Params = map[string]any{}
	}
	task.Assets, task.DeletedAssetSlots = generationAssetsFromTaskAssetModels(model.ID, model.Assets)

	return task, nil
}

func generationTaskReferencesFromModels(models []domain.GenerationTaskReferenceModel) ([]string, []string) {
	if len(models) == 0 {
		return []string{}, []string{}
	}
	sort.SliceStable(models, func(i, j int) bool {
		return models[i].RefIndex < models[j].RefIndex
	})
	urls := []string{}
	assetIDs := []string{}
	for _, model := range models {
		if url := domain.StringValue(model.URL); url != "" {
			urls = append(urls, url)
		}
		if assetID := domain.StringValue(model.AssetID); assetID != "" {
			assetIDs = append(assetIDs, assetID)
		}
	}
	return urls, assetIDs
}

func generationTaskReferenceModelsFromRecord(task GenerationTaskRecord) []domain.GenerationTaskReferenceModel {
	rows := make([]domain.GenerationTaskReferenceModel, 0, len(task.ReferenceURLs)+len(task.ReferenceAssetIDs))
	createdAt := domain.TimeFromString(task.CreatedAt)
	refIndex := 0
	for _, value := range task.ReferenceURLs {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		rows = append(rows, domain.GenerationTaskReferenceModel{
			TaskID:    task.ID,
			RefIndex:  refIndex,
			URL:       domain.StringPtr(value),
			CreatedAt: createdAt,
		})
		refIndex++
	}
	for _, value := range task.ReferenceAssetIDs {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		rows = append(rows, domain.GenerationTaskReferenceModel{
			TaskID:    task.ID,
			RefIndex:  refIndex,
			AssetID:   domain.StringPtr(value),
			CreatedAt: createdAt,
		})
		refIndex++
	}
	return rows
}

func generationAssetsFromTaskAssetModels(taskID string, rows []domain.GenerationTaskAssetModel) ([]GenerationAsset, []int) {
	if len(rows) == 0 {
		return []GenerationAsset{}, []int{}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].SlotIndex < rows[j].SlotIndex
	})
	assets := make([]GenerationAsset, 0, len(rows))
	deleted := []int{}
	nextSlot := 0
	for _, row := range rows {
		for nextSlot < row.SlotIndex {
			deleted = append(deleted, nextSlot)
			nextSlot++
		}
		asset := row.Asset
		assets = append(assets, GenerationAsset{
			AssetID:      row.AssetID,
			Kind:         asset.Kind,
			TaskID:       taskID,
			Title:        asset.Filename,
			URL:          asset.URL,
			PosterURL:    asset.PosterURL,
			MIMEType:     asset.MIMEType,
			DownloadPath: generationAssetDownloadPath(asset),
			SlotIndex:    row.SlotIndex,
			Selected:     row.Selected,
		})
		nextSlot = row.SlotIndex + 1
	}
	return assets, normalizeGenerationDeletedAssetSlots(deleted)
}

func generationTaskAssetModelsFromRecord(task GenerationTaskRecord) []domain.GenerationTaskAssetModel {
	deletedSlots := generationDeletedAssetSlotSet(task.DeletedAssetSlots)
	rows := make([]domain.GenerationTaskAssetModel, 0, len(task.Assets))
	for index, asset := range task.Assets {
		slotIndex := assetSlotIndex(index, asset)
		if deletedSlots[slotIndex] {
			continue
		}
		rows = append(rows, domain.GenerationTaskAssetModel{
			TaskID:    task.ID,
			SlotIndex: slotIndex,
			AssetID:   firstNonEmpty(asset.AssetID, libraryAssetIDFromGenerationAssetURL(asset.URL)),
			Selected:  asset.Selected,
			CreatedAt: domain.TimeFromString(task.CreatedAt),
			UpdatedAt: domain.TimeFromString(task.UpdatedAt),
		})
	}
	return rows
}

func assetSlotIndex(fallback int, asset GenerationAsset) int {
	if asset.SlotIndex > 0 || fallback == 0 {
		return asset.SlotIndex
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func projectSelectedAssetModelsFromRecord(task GenerationTaskRecord) []domain.ProjectSelectedAssetModel {
	projectID := GenerationProjectIDForRequest(task.ProjectID, "")
	resourceType := generationTaskResourceType(task)
	if projectID == "" || resourceType == "" {
		return []domain.ProjectSelectedAssetModel{}
	}
	deletedSlots := generationDeletedAssetSlotSet(task.DeletedAssetSlots)
	rows := []domain.ProjectSelectedAssetModel{}
	for index, asset := range task.Assets {
		slotIndex := assetSlotIndex(index, asset)
		if deletedSlots[slotIndex] || !asset.Selected || !isSelectableGenerationAssetKind(asset.Kind) {
			continue
		}
		row := domain.ProjectSelectedAssetModel{
			ProjectID:        projectID,
			ResourceType:     resourceType,
			ResourceTitle:    domain.StringPtr(asset.Title),
			AssetID:          firstNonEmpty(asset.AssetID, libraryAssetIDFromGenerationAssetURL(asset.URL)),
			SourceType:       domain.StringPtr("generated"),
			SourceTaskID:     domain.StringPtr(task.ID),
			SourceSlotIndex:  slotIndex,
			SourceDocumentID: domain.StringPtr(task.DocumentID),
			ResourceID:       domain.StringPtr(task.SectionID),
			CreatedAt:        domain.TimeFromString(task.CreatedAt),
			UpdatedAt:        domain.TimeFromString(task.UpdatedAt),
		}
		if strings.TrimSpace(row.AssetID) == "" {
			continue
		}
		row.ID = projectSelectedAssetID(row)
		rows = append(rows, row)
	}
	return rows
}

func (service *GenerationTaskService) syncProjectSelectedAssetRowForTaskAssetLocked(task GenerationTaskRecord, assetIndex int) error {
	row, ok := projectSelectedAssetModelFromTaskAsset(task, assetIndex, false)
	if !ok {
		return nil
	}
	asset, ok := generationAssetAtSlot(task, assetIndex)
	if ok && asset.Selected {
		return service.replaceResourceSelectionLocked(row, asset.Kind)
	}
	_, err := service.repo.DeleteProjectSelectedAsset(row.ID)
	return err
}

// replaceResourceSelectionLocked is the single write path for "this asset is
// now the resource's selection": selection is single-choice per resource+kind,
// so the previous selection is cleared (including resetting the old task
// asset's Selected flag) before the new row is written. Every selection entry
// point must go through here — a plain upsert would stack a second selected
// image onto the resource card.
func (service *GenerationTaskService) replaceResourceSelectionLocked(row domain.ProjectSelectedAssetModel, kind string) error {
	if err := service.clearProjectSelectedAssetRowsForResourceKindLocked(row, kind); err != nil {
		return err
	}
	return service.repo.UpsertProjectSelectedAsset(row)
}

func (service *GenerationTaskService) deleteProjectSelectedAssetRowForTaskAssetLocked(task GenerationTaskRecord, assetIndex int) error {
	row, ok := projectSelectedAssetModelFromTaskAsset(task, assetIndex, true)
	if !ok {
		return nil
	}
	if _, err := service.repo.DeleteProjectSelectedAsset(row.ID); err != nil {
		return err
	}
	_, err := service.repo.DeleteProjectSelectedAssetByTaskSlot(
		row.ProjectID,
		row.ResourceType,
		task.ID,
		assetIndex,
	)
	return err
}

func projectSelectedAssetModelFromTaskAsset(task GenerationTaskRecord, assetIndex int, includeDeleted bool) (domain.ProjectSelectedAssetModel, bool) {
	projectID := GenerationProjectIDForRequest(task.ProjectID, "")
	resourceType := generationTaskResourceType(task)
	if projectID == "" || resourceType == "" || assetIndex < 0 {
		return domain.ProjectSelectedAssetModel{}, false
	}
	if !includeDeleted && generationDeletedAssetSlotSet(task.DeletedAssetSlots)[assetIndex] {
		return domain.ProjectSelectedAssetModel{}, false
	}
	asset, ok := generationAssetAtSlot(task, assetIndex)
	if !ok {
		return domain.ProjectSelectedAssetModel{}, false
	}
	if !isSelectableGenerationAssetKind(asset.Kind) {
		return domain.ProjectSelectedAssetModel{}, false
	}
	row := domain.ProjectSelectedAssetModel{
		ProjectID:        projectID,
		ResourceType:     resourceType,
		ResourceTitle:    domain.StringPtr(asset.Title),
		AssetID:          firstNonEmpty(asset.AssetID, libraryAssetIDFromGenerationAssetURL(asset.URL)),
		SourceType:       domain.StringPtr("generated"),
		SourceTaskID:     domain.StringPtr(task.ID),
		SourceSlotIndex:  assetIndex,
		SourceDocumentID: domain.StringPtr(task.DocumentID),
		ResourceID:       domain.StringPtr(task.SectionID),
		CreatedAt:        domain.TimeFromString(task.CreatedAt),
		UpdatedAt:        domain.TimeFromString(task.UpdatedAt),
	}
	if strings.TrimSpace(row.AssetID) == "" {
		return domain.ProjectSelectedAssetModel{}, false
	}
	row.ID = projectSelectedAssetID(row)
	return row, true
}

func generationAssetAtSlot(task GenerationTaskRecord, slotIndex int) (GenerationAsset, bool) {
	index, ok := generationAssetSliceIndexForSlot(task, slotIndex)
	if !ok {
		return GenerationAsset{}, false
	}
	return task.Assets[index], true
}

func generationAssetSliceIndexForSlot(task GenerationTaskRecord, slotIndex int) (int, bool) {
	if slotIndex < 0 {
		return 0, false
	}
	for index, asset := range task.Assets {
		if assetSlotIndex(index, asset) == slotIndex {
			return index, true
		}
	}
	return 0, false
}

func projectSelectedAssetModelFromRequest(projectID string, request UpdateSelectedGenerationAssetRequest) domain.ProjectSelectedAssetModel {
	sourceTaskID := strings.TrimSpace(request.SourceTaskID)
	if sourceTaskID == "" {
		sourceTaskID = strings.TrimSpace(request.TaskID)
	}
	assetID := firstNonEmpty(request.MediaAssetID, libraryAssetIDFromGenerationAssetURL(request.URL))
	resourceTitle := strings.TrimSpace(request.ResourceTitle)
	if resourceTitle == "" {
		resourceTitle = strings.TrimSpace(request.Title)
	}
	return domain.ProjectSelectedAssetModel{
		ProjectID:        GenerationProjectIDForRequest(projectID, ""),
		ResourceType:     selectedGenerationResourceType(request.ResourceType),
		ResourceID:       domain.StringPtr(request.ResourceID),
		ResourceTitle:    domain.StringPtr(resourceTitle),
		AssetID:          assetID,
		SourceType:       domain.StringPtr(normalizeProjectSelectedAssetSourceType(request.SourceType)),
		SourceTaskID:     domain.StringPtr(sourceTaskID),
		SourceSlotIndex:  selectedAssetRequestSourceIndex(request),
		SourceDocumentID: domain.StringPtr(request.SourceDocumentID),
		SortOrder:        request.SortOrder,
	}
}

func normalizeProjectSelectedAssetModelForUpsert(model domain.ProjectSelectedAssetModel) domain.ProjectSelectedAssetModel {
	if domain.StringValue(model.SourceType) == "" {
		switch {
		case domain.StringValue(model.SourceTaskID) != "":
			model.SourceType = domain.StringPtr("generated")
		case domain.StringValue(model.SourceDocumentID) != "":
			model.SourceType = domain.StringPtr("document")
		case strings.TrimSpace(model.AssetID) != "":
			model.SourceType = domain.StringPtr("uploaded")
		}
	}
	return model
}

func projectSelectedAssetModelHasDirectPayload(model domain.ProjectSelectedAssetModel) bool {
	return strings.TrimSpace(model.AssetID) != "" ||
		domain.StringValue(model.SourceDocumentID) != ""
}

func selectedGenerationAssetRecordFromModel(model domain.ProjectSelectedAssetModel) SelectedGenerationAssetRecord {
	asset := model.Asset
	return SelectedGenerationAssetRecord{
		ID:               model.ID,
		TaskID:           domain.StringValue(model.SourceTaskID),
		AssetIndex:       model.SourceSlotIndex,
		ResourceType:     model.ResourceType,
		ResourceID:       domain.StringValue(model.ResourceID),
		ResourceTitle:    domain.StringValue(model.ResourceTitle),
		MediaAssetID:     model.AssetID,
		Kind:             asset.Kind,
		Title:            firstNonEmpty(domain.StringValue(model.ResourceTitle), asset.Filename),
		URL:              asset.URL,
		PosterURL:        asset.PosterURL,
		MIMEType:         asset.MIMEType,
		DownloadPath:     generationAssetDownloadPath(asset),
		SourceType:       domain.StringValue(model.SourceType),
		SourceTaskID:     domain.StringValue(model.SourceTaskID),
		SourceAssetIndex: model.SourceSlotIndex,
		SourceDocumentID: domain.StringValue(model.SourceDocumentID),
		SortOrder:        model.SortOrder,
		CreatedAt:        domain.StringFromTime(model.CreatedAt),
		UpdatedAt:        domain.StringFromTime(model.UpdatedAt),
	}
}

func generationAssetDownloadPath(asset domain.AssetModel) string {
	relPath := strings.TrimSpace(asset.RelPath)
	if relPath == "" {
		return ""
	}
	if filepath.IsAbs(relPath) {
		return filepath.Clean(relPath)
	}

	relPath = filepath.ToSlash(relPath)
	projectID := domain.CleanProjectID(domain.StringValue(asset.ProjectID))
	if projectID != "" {
		projectDir := strings.TrimSpace(asset.Project.ProjectDir)
		if projectDir == "" && strings.TrimSpace(asset.Project.RelativeDir) != "" {
			projectDir = filepath.Join(
				serviceshared.WorkspacePathsFor("").Root,
				filepath.FromSlash(asset.Project.RelativeDir),
			)
		}
		if projectDir == "" {
			return ""
		}
		return filepath.Join(serviceshared.ResolveWorkspaceDir(projectDir), filepath.FromSlash(relPath))
	}

	paths := serviceshared.WorkspacePathsFor("")
	if strings.HasPrefix(relPath, ".mediago-drama/") {
		return filepath.Join(paths.Root, filepath.FromSlash(relPath))
	}
	relPath = strings.TrimPrefix(relPath, "library/")
	return filepath.Join(paths.LibraryAssetsDir(), filepath.FromSlash(relPath))
}

func selectedAssetRequestSourceIndex(request UpdateSelectedGenerationAssetRequest) int {
	if request.SourceAssetIndex != nil {
		return *request.SourceAssetIndex
	}
	if request.AssetIndex != nil {
		return *request.AssetIndex
	}
	return -1
}

func selectedAssetResourceFromTask(task GenerationTaskRecord) (string, string) {
	documentID := strings.TrimSpace(task.DocumentID)
	sectionID := strings.TrimSpace(task.SectionID)
	if documentID == "" || sectionID == "" {
		return "", ""
	}
	return documentID, sectionID
}

func normalizeProjectSelectedAssetSourceType(value string) string {
	switch strings.TrimSpace(value) {
	case "generated", "edited", "uploaded", "document", "imported":
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func projectSelectedAssetID(row domain.ProjectSelectedAssetModel) string {
	source := ""
	if domain.StringValue(row.SourceTaskID) != "" && row.SourceSlotIndex >= 0 {
		source = fmt.Sprintf("task:%s:%d", domain.StringValue(row.SourceTaskID), row.SourceSlotIndex)
	}
	if source == "" {
		source = strings.TrimSpace(row.AssetID)
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{
		GenerationProjectIDForRequest(row.ProjectID, ""),
		strings.TrimSpace(row.ResourceType),
		domain.StringValue(row.ResourceID),
		domain.StringValue(row.ResourceTitle),
		source,
	}, "\x00")))
	return "selected-" + hex.EncodeToString(sum[:])[:24]
}

func libraryAssetIDFromGenerationAssetURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for index, segment := range segments {
		if segment == "media-assets" && index+2 < len(segments) && segments[index+2] == "content" {
			id, err := url.PathUnescape(segments[index+1])
			if err != nil {
				return strings.TrimSpace(segments[index+1])
			}
			return strings.TrimSpace(id)
		}
		if segment == "media" && index+3 < len(segments) && segments[index+1] == "assets" && segments[index+3] == "content" {
			id, err := url.PathUnescape(segments[index+2])
			if err != nil {
				return strings.TrimSpace(segments[index+2])
			}
			return strings.TrimSpace(id)
		}
	}
	return ""
}

func normalizeGenerationDeletedAssetSlots(slots []int) []int {
	if len(slots) == 0 {
		return []int{}
	}
	sort.Ints(slots)
	normalized := make([]int, 0, len(slots))
	for _, slot := range slots {
		if slot < 0 {
			continue
		}
		if len(normalized) > 0 && normalized[len(normalized)-1] == slot {
			continue
		}
		normalized = append(normalized, slot)
	}
	return normalized
}

func GenerationTaskForClient(task GenerationTaskRecord) GenerationTaskRecord {
	task.Params = generationParamsForClient(task.Params)
	deletedSlots := generationDeletedAssetSlotSet(task.DeletedAssetSlots)
	if len(deletedSlots) == 0 {
		task.Assets = generationAssetsWithTaskSlots(task.ID, task.Assets)
		task.DeletedAssetSlots = normalizeGenerationDeletedAssetSlots(task.DeletedAssetSlots)
		return task
	}

	assets := make([]GenerationAsset, 0, len(task.Assets))
	for index, asset := range task.Assets {
		slotIndex := assetSlotIndex(index, asset)
		if deletedSlots[slotIndex] {
			continue
		}
		asset.SlotIndex = slotIndex
		asset.TaskID = task.ID
		assets = append(assets, asset)
	}
	task.Assets = assets
	task.DeletedAssetSlots = normalizeGenerationDeletedAssetSlots(task.DeletedAssetSlots)
	return task
}

func GenerationTasksForClient(tasks []GenerationTaskRecord) []GenerationTaskRecord {
	next := make([]GenerationTaskRecord, 0, len(tasks))
	for _, task := range tasks {
		next = append(next, GenerationTaskForClient(task))
	}
	return next
}

func generationAssetsWithTaskSlots(taskID string, assets []GenerationAsset) []GenerationAsset {
	if len(assets) == 0 {
		return assets
	}
	next := make([]GenerationAsset, 0, len(assets))
	for index, asset := range assets {
		asset.SlotIndex = index
		asset.TaskID = taskID
		next = append(next, asset)
	}
	return next
}

func generationDeletedAssetSlotSet(slots []int) map[int]bool {
	if len(slots) == 0 {
		return nil
	}
	set := make(map[int]bool, len(slots))
	for _, slot := range slots {
		if slot >= 0 {
			set[slot] = true
		}
	}
	return set
}

func isStaleSubmittingGenerationTask(task GenerationTaskRecord, now time.Time) bool {
	updatedAt, err := timestamp.ParseRFC3339Nano(task.UpdatedAt)
	if err != nil {
		return true
	}
	return now.Sub(updatedAt) >= submittingGenerationRetryDelay
}

// isExpiredBackgroundImageGeneration reports whether a background-recovered image task has
// been pending past maxBackgroundImageGenerationAge (measured from submission).
func isExpiredBackgroundImageGeneration(task GenerationTaskRecord, now time.Time) bool {
	createdAt, err := timestamp.ParseRFC3339Nano(task.CreatedAt)
	if err != nil {
		return false
	}
	return now.Sub(createdAt) >= maxBackgroundImageGenerationAge
}

func generationConversationRecordFromModel(model generationConversationModel) GenerationConversationRecord {
	return GenerationConversationRecord{
		ID:        model.ID,
		ScopeID:   model.ScopeID,
		Kind:      model.Kind,
		Title:     model.Title,
		Default:   IsDefaultGenerationConversationID(model.ID),
		CreatedAt: domain.StringFromTime(model.CreatedAt),
		UpdatedAt: domain.StringFromTime(model.UpdatedAt),
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
			CreatedAt: domain.StringFromTime(model.CreatedAt),
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
