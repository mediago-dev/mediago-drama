package generation

import (
	"context"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const jimengSeedanceQueueScanLimit = 100

var (
	jimengSeedanceQueuedStatuses = []string{
		"queued",
	}
	jimengSeedanceBlockingStatuses = []string{
		"queued",
		"submitting",
		"submitted",
		"running",
		"pending",
		"processing",
	}
	jimengSeedanceActiveStatuses = []string{
		"submitting",
		"submitted",
		"running",
		"pending",
		"processing",
	}
	jimengSeedanceQueuedRouteIDs = []string{
		coregeneration.RouteJimengSeedance20,
		coregeneration.RouteJimengSeedance20Fast,
	}
)

// QueuedGenerationResponse returns a local async queue response.
func QueuedGenerationResponse(id string, kind coregeneration.Kind) GenerationMessageResponse {
	message := "生成请求已进入队列，前一个任务完成后会自动提交。"
	if kind == coregeneration.KindVideo {
		message = "即梦 Seedance 视频任务已进入队列，前一个任务完成后会自动提交。"
	}
	return GenerationMessageResponse{
		ID:      ValueOrFallback(id, sharedRandomGenerationID()),
		Role:    "assistant",
		Status:  "queued",
		Message: message,
		Assets:  []GenerationAsset{},
		Usage:   GenerationUsage{},
	}
}

func sharedRandomGenerationID() string {
	return shared.MustRandomID("generation")
}

func shouldQueueJimengSeedanceSubmission(route coregeneration.ModelRoute) bool {
	switch strings.TrimSpace(route.ID) {
	case coregeneration.RouteJimengSeedance20, coregeneration.RouteJimengSeedance20Fast:
		return route.Provider == coregeneration.ProviderJimeng && route.Kind == coregeneration.KindVideo && route.Async
	default:
		return false
	}
}

func (workflow *GenerationService) jimengSeedanceSubmissionQueueBlocked(excludeTaskID string) (bool, error) {
	tasks, err := workflow.listJimengSeedanceQueueTasks(jimengSeedanceBlockingStatuses, excludeTaskID)
	if err != nil {
		return false, err
	}
	return len(tasks) > 0, nil
}

func (workflow *GenerationService) jimengSeedanceQueuedTaskCanSubmit(taskID string) (bool, error) {
	active, err := workflow.listJimengSeedanceQueueTasks(jimengSeedanceActiveStatuses, taskID)
	if err != nil {
		return false, err
	}
	if len(active) > 0 {
		return false, nil
	}

	queued, err := workflow.listJimengSeedanceQueueTasks(jimengSeedanceQueuedStatuses, "")
	if err != nil {
		return false, err
	}
	if len(queued) == 0 {
		return false, nil
	}

	return strings.TrimSpace(queued[0].ID) == strings.TrimSpace(taskID), nil
}

func (workflow *GenerationService) listJimengSeedanceQueueTasks(statuses []string, excludeTaskID string) ([]GenerationTaskRecord, error) {
	if workflow == nil || workflow.generationTasks == nil {
		return []GenerationTaskRecord{}, nil
	}
	return workflow.generationTasks.ListVideoTasksByStatusesAndRoutes(
		statuses,
		jimengSeedanceQueuedRouteIDs,
		excludeTaskID,
		jimengSeedanceQueueScanLimit,
	)
}

func (workflow *GenerationService) submitQueuedJimengSeedanceGeneration(
	ctx context.Context,
	task generationTaskRecord,
	provider coregeneration.Provider,
	request coregeneration.Request,
) {
	workflow.jimengSeedanceQueueMu.Lock()
	canSubmit, err := workflow.jimengSeedanceQueuedTaskCanSubmit(task.ID)
	if err != nil {
		workflow.jimengSeedanceQueueMu.Unlock()
		_ = workflow.generationTasks.RecordAttempt(task.ID, "queue", task.Status, "即梦 Seedance 队列检查失败。", err)
		return
	}
	if !canSubmit {
		workflow.jimengSeedanceQueueMu.Unlock()
		_ = workflow.generationTasks.RecordAttempt(task.ID, "queue", task.Status, "即梦 Seedance 队列等待前一个任务完成。", nil)
		return
	}

	submittingTask := task
	submittingTask.Status = "submitting"
	submittingTask.Message = "即梦 Seedance 队列已轮到此任务，正在提交到模型服务。"
	submittingTask.Error = ""
	submittingTask.ErrorCode = ""
	submittingTask.ErrorType = ""
	submittingTask.Retryable = false
	submittingTask.ProviderTaskID = ""
	existed, err := workflow.generationTasks.UpsertExisting(submittingTask)
	workflow.jimengSeedanceQueueMu.Unlock()
	if err != nil {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "queue", task.Status, "即梦 Seedance 队列提交状态保存失败。", err)
		return
	}
	if !existed {
		return
	}

	workflow.syncGenerationNotificationTask(submittingTask)
	workflow.submitPendingGeneration(
		ctx,
		submittingTask,
		provider,
		request,
		"queue",
		workflow.projectIDForTask(task),
		task.ConversationID,
	)
}
