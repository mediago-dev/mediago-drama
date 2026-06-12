package generation

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	coregeneration "github.com/torchstellar-team/mediago-drama/packages/core/pkg/generation"
)

// GetGenerationVideo polls one generation video task for HTTP handlers.
func (workflow *GenerationService) GetGenerationVideo(ctx context.Context, id string) (generationMessageResponse, int, error) {
	storedTask, found, err := workflow.generationTasks.Get(id)
	if err != nil {
		return generationMessageResponse{}, http.StatusInternalServerError, err
	}
	if found {
		pollID := GenerationTaskProviderPollID(storedTask)
		if pollID == "" {
			return GenerationResponseFromTask(storedTask), http.StatusOK, nil
		}
		id = pollID
	}

	provider, err := workflow.newGenerationProviderForStoredTask(id, storedTask, found)
	if err != nil {
		return generationMessageResponse{}, http.StatusServiceUnavailable, err
	}

	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	response, err := provider.Get(pollCtx, id)
	if err != nil {
		if found {
			_ = workflow.generationTasks.RecordError(id, err)
			_ = workflow.generationTasks.RecordAttempt(id, "poll", storedTask.Status, "Manual status check failed.", err)
		}
		return generationMessageResponse{}, http.StatusBadGateway, err
	}
	projectID := ""
	studioSessionID := ""
	if found {
		projectID = workflow.projectIDForTask(storedTask)
		studioSessionID = workflow.studioSessionIDForTask(storedTask)
	}
	response = workflow.cacheGenerationResponseAssetsForScope(ctx, response, projectID, studioSessionID)

	messageResponse := GenerationResponseFromCore(response, string(coregeneration.KindVideo))
	if found {
		messageResponse.ID = storedTask.ID
		storedTask = GenerationTaskWithMessage(storedTask, messageResponse)
		if err := workflow.generationTasks.Upsert(storedTask); err != nil {
			messageResponse.Message = AppendStorageWarning(messageResponse.Message, err)
		} else {
			workflow.syncGenerationNotificationTask(storedTask)
			_ = workflow.generationTasks.RecordAttempt(storedTask.ID, "poll", messageResponse.Status, messageResponse.Message, nil)
		}
	}

	return messageResponse, http.StatusOK, nil
}

// RetryGenerationTask retries a generation task for HTTP handlers.
func (workflow *GenerationService) RetryGenerationTask(ctx context.Context, id string) (generationMessageResponse, int, error) {
	task, ok, err := workflow.generationTasks.Get(id)
	if err != nil {
		return generationMessageResponse{}, http.StatusInternalServerError, err
	}
	if !ok {
		return generationMessageResponse{}, http.StatusNotFound, fmt.Errorf("generation task not found")
	}
	projectID := workflow.projectIDForTask(task)

	payload := generationMessageRequest{
		Kind:              task.Kind,
		ConversationID:    task.ConversationID,
		RouteID:           task.RouteID,
		FamilyID:          task.FamilyID,
		VersionID:         task.VersionID,
		Provider:          task.Provider,
		ModelID:           task.ModelID,
		Model:             task.Model,
		ProjectID:         task.ProjectID,
		SectionID:         task.SectionID,
		CapabilityID:      task.CapabilityID,
		Prompt:            task.Prompt,
		ReferenceURLs:     task.ReferenceURLs,
		ReferenceAssetIDs: task.ReferenceAssetIDs,
		Params:            task.Params,
	}

	route, err := ResolveGenerationRoute(payload)
	if err != nil {
		return generationMessageResponse{}, http.StatusBadRequest, err
	}
	payload.Kind = string(route.Kind)
	payload.RouteID = route.ID
	payload.FamilyID = route.FamilyID
	payload.VersionID = route.VersionID
	payload.Provider = route.Provider
	if payload.Model == "" {
		payload.Model = route.Model
	}
	if payload.ModelID == "" {
		payload.ModelID = route.LegacyModelID
	}
	if err := workflow.requireGenerationRouteConfigured(route); err != nil {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "retry", task.Status, "重试所需供应商未配置。", err)
		return generationMessageResponse{}, http.StatusServiceUnavailable, err
	}

	provider, err := workflow.newGenerationProvider(route)
	if err != nil {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "retry", task.Status, "重试所需供应商未配置。", err)
		return generationMessageResponse{}, http.StatusServiceUnavailable, err
	}
	referenceURLs, err := workflow.resolveGenerationReferences(route, payload)
	if err != nil {
		return generationMessageResponse{}, http.StatusBadRequest, err
	}

	generationRequest := GenerationRequestFromMessage(payload, route, referenceURLs)
	if ShouldSubmitGenerationInBackground(route) {
		messageResponse := SubmittingGenerationResponse(task.ID, coregeneration.Kind(payload.Kind))
		nextTask := GenerationTaskWithMessage(task, messageResponse)
		nextTask.ProviderTaskID = ""
		if err := workflow.generationTasks.Upsert(nextTask); err != nil {
			return generationMessageResponse{}, http.StatusInternalServerError, err
		}
		workflow.syncGenerationNotificationTask(nextTask)
		_ = workflow.generationTasks.RecordAttempt(task.ID, "retry", messageResponse.Status, messageResponse.Message, nil)
		go workflow.submitPendingGeneration(context.Background(), nextTask, provider, generationRequest, "retry", projectID, workflow.studioSessionIDForTask(task))
		return messageResponse, http.StatusOK, nil
	}
	if ShouldRunGenerationInBackground(route) {
		messageResponse := SubmittedGenerationResponse(task.ID, coregeneration.Kind(payload.Kind))
		nextTask := GenerationTaskWithMessage(task, messageResponse)
		if err := workflow.generationTasks.Upsert(nextTask); err != nil {
			return generationMessageResponse{}, http.StatusInternalServerError, err
		}
		workflow.syncGenerationNotificationTask(nextTask)
		_ = workflow.generationTasks.RecordAttempt(task.ID, "retry", messageResponse.Status, messageResponse.Message, nil)
		go workflow.completeSubmittedGeneration(context.Background(), nextTask, provider, generationRequest, "retry", projectID, workflow.studioSessionIDForTask(task))
		return messageResponse, http.StatusOK, nil
	}

	runCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()

	response, err := workflow.generateWithProvider(
		runCtx,
		provider,
		generationRequest,
		generationProviderLogContext{Action: "retry", TaskID: task.ID},
	)
	if err != nil {
		messageResponse := FailedGenerationResponse(task.ID, err)
		nextTask := GenerationTaskWithMessage(task, messageResponse)
		if saveErr := workflow.generationTasks.Upsert(nextTask); saveErr != nil {
			messageResponse.Message = AppendStorageWarning(messageResponse.Message, saveErr)
		} else {
			workflow.syncGenerationNotificationTask(nextTask)
			_ = workflow.generationTasks.RecordAttempt(task.ID, "retry", messageResponse.Status, messageResponse.Message, err)
		}
		return messageResponse, http.StatusOK, nil
	}
	response = workflow.cacheGenerationResponseAssetsForScope(ctx, response, projectID, workflow.studioSessionIDForTask(task))

	messageResponse := GenerationResponseFromCore(response, payload.Kind)
	if ShouldPersistGenerationTask(route) {
		nextTask := GenerationTaskFromMessage(payload, route, messageResponse)
		if err := workflow.generationTasks.Upsert(nextTask); err != nil {
			messageResponse.Message = AppendStorageWarning(messageResponse.Message, err)
		} else {
			workflow.syncGenerationNotificationTask(nextTask)
			_ = workflow.generationTasks.RecordAttempt(nextTask.ID, "retry", messageResponse.Status, messageResponse.Message, nil)
			if nextTask.ID != task.ID {
				_ = workflow.generationTasks.RecordAttempt(task.ID, "retry", messageResponse.Status, "Retry created "+nextTask.ID, nil)
			}
		}
	}

	return messageResponse, http.StatusOK, nil
}

func (workflow *GenerationService) generationRequestForTask(
	task generationTaskRecord,
	route coregeneration.ModelRoute,
) (coregeneration.Request, error) {
	payload := generationMessageRequest{
		Kind:              task.Kind,
		RouteID:           route.ID,
		FamilyID:          route.FamilyID,
		VersionID:         route.VersionID,
		Provider:          route.Provider,
		ModelID:           task.ModelID,
		Model:             task.Model,
		ProjectID:         task.ProjectID,
		ConversationID:    task.ConversationID,
		Prompt:            task.Prompt,
		ReferenceURLs:     task.ReferenceURLs,
		ReferenceAssetIDs: task.ReferenceAssetIDs,
		Params:            task.Params,
	}
	if payload.Model == "" {
		payload.Model = route.Model
	}
	if payload.ModelID == "" {
		payload.ModelID = route.LegacyModelID
	}
	referenceURLs, err := workflow.resolveGenerationReferences(route, payload)
	if err != nil {
		return coregeneration.Request{}, err
	}
	return GenerationRequestFromMessage(payload, route, referenceURLs), nil
}

// ListGenerationTasks lists generation tasks for HTTP handlers.
func (workflow *GenerationService) ListGenerationTasks(query GenerationTaskListQuery) (generationTasksResponse, error) {
	kind := strings.TrimSpace(query.Kind)
	conversationID := strings.TrimSpace(query.ConversationID)
	projectID := strings.TrimSpace(query.ProjectID)
	hasScopeFilter := strings.TrimSpace(query.ScopeID) != ""
	scopeID := NormalizeGenerationConversationScopeID(query.ScopeID)
	includeLegacyDefault := false
	listOptions := generationTaskListOptions(query.Limit, query.Offset)
	if projectID != "" {
		tasks, err := workflow.generationTasks.ListByProject(kind, projectID, listOptions)
		if err != nil {
			return generationTasksResponse{}, err
		}
		return generationTasksResponse{Tasks: tasks}, nil
	} else if conversationID != "" {
		conversation, status, err := workflow.resolveGenerationConversationWithScopeFilter(conversationID, scopeID, kind, hasScopeFilter)
		if err != nil {
			if status == http.StatusNotFound {
				return generationTasksResponse{Tasks: []GenerationTaskRecord{}}, nil
			}
			return generationTasksResponse{}, err
		}
		kind = conversation.Kind
		conversationID = conversation.ID
		includeLegacyDefault = includeLegacyDefaultGenerationTasks(conversation.ScopeID, conversation.Kind, conversation.ID)
	} else if kind != "" {
		conversationID = DefaultGenerationConversationID(scopeID, kind)
		includeLegacyDefault = includeLegacyDefaultGenerationTasks(scopeID, kind, conversationID)
	} else {
		tasks, err := workflow.generationTasks.List(listOptions)
		if err != nil {
			return generationTasksResponse{}, err
		}
		return generationTasksResponse{Tasks: tasks}, nil
	}

	tasks, err := workflow.generationTasks.ListByConversation(kind, conversationID, includeLegacyDefault, listOptions)
	if err != nil {
		return generationTasksResponse{}, err
	}
	return generationTasksResponse{Tasks: tasks}, nil
}

// GetGenerationTask returns a generation task for HTTP handlers.
func (workflow *GenerationService) GetGenerationTask(id string) (generationTaskRecord, bool, error) {
	return workflow.generationTasks.Get(id)
}

// DeleteGenerationTask deletes a generation task and returns the updated task list.
func (workflow *GenerationService) DeleteGenerationTask(id string) (generationTasksResponse, bool, error) {
	deleted, err := workflow.generationTasks.Delete(id)
	if err != nil || !deleted {
		return generationTasksResponse{}, deleted, err
	}
	response, err := workflow.ListGenerationTasks(GenerationTaskListQuery{})
	return response, true, err
}

// PollPendingGenerationTasks polls pending generation tasks in the background.
func (workflow *GenerationService) PollPendingGenerationTasks(ctx context.Context, limit int) {
	tasks, err := workflow.generationTasks.ListPending(limit)
	if err != nil {
		return
	}

	const maxPollConcurrency = 5
	concurrency := len(tasks)
	if concurrency > maxPollConcurrency {
		concurrency = maxPollConcurrency
	}
	if concurrency <= 1 {
		for _, task := range tasks {
			workflow.PollGenerationTask(ctx, task)
		}
		return
	}

	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for _, task := range tasks {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(task generationTaskRecord) {
			defer wg.Done()
			defer func() { <-sem }()
			workflow.PollGenerationTask(ctx, task)
		}(task)
	}
	wg.Wait()
}

// PollGenerationTask polls one generation task and persists the result.
func (workflow *GenerationService) PollGenerationTask(ctx context.Context, task generationTaskRecord) {
	route, err := RouteForStoredGenerationTask(task.ID, task, true)
	if err != nil {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "poll", task.Status, "后台轮询的供应商未配置。", err)
		return
	}
	provider, err := workflow.newGenerationProvider(route)
	if err != nil {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "poll", task.Status, "后台轮询的供应商未配置。", err)
		return
	}
	if strings.EqualFold(strings.TrimSpace(task.Status), "submitting") {
		generationRequest, err := workflow.generationRequestForTask(task, route)
		if err != nil {
			_ = workflow.generationTasks.RecordAttempt(task.ID, "create", task.Status, "后台提交视频任务失败。", err)
			return
		}
		workflow.submitPendingGeneration(ctx, task, provider, generationRequest, "create", workflow.projectIDForTask(task), workflow.studioSessionIDForTask(task))
		return
	}
	pollID := GenerationTaskProviderPollID(task)
	if pollID == "" {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "poll", task.Status, "后台状态检查等待供应商任务 ID。", nil)
		return
	}

	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	response, err := provider.Get(pollCtx, pollID)
	if err != nil {
		_ = workflow.generationTasks.RecordError(task.ID, err)
		_ = workflow.generationTasks.RecordAttempt(task.ID, "poll", task.Status, "后台状态检查失败。", err)
		return
	}

	response = workflow.cacheGenerationResponseAssetsForScope(ctx, response, workflow.projectIDForTask(task), workflow.studioSessionIDForTask(task))
	messageResponse := GenerationResponseFromCore(response, task.Kind)
	messageResponse.ID = task.ID
	task = GenerationTaskWithMessage(task, messageResponse)
	if err := workflow.generationTasks.Upsert(task); err != nil {
		_ = workflow.generationTasks.RecordAttempt(task.ID, "poll", messageResponse.Status, "后台状态检查结果保存失败。", err)
		return
	}
	workflow.syncGenerationNotificationTask(task)

	_ = workflow.generationTasks.RecordAttempt(task.ID, "poll", messageResponse.Status, messageResponse.Message, nil)
}

func (workflow *GenerationService) submitPendingGeneration(
	ctx context.Context,
	task generationTaskRecord,
	provider coregeneration.Provider,
	request coregeneration.Request,
	action string,
	projectID string,
	studioSessionID string,
) {
	submittingTask := task
	submittingTask.Status = "submitting"
	submittingTask.Message = "视频生成任务正在提交到模型服务，完成提交后会自动检查状态。"
	submittingTask.Error = ""
	if err := workflow.generationTasks.Upsert(submittingTask); err != nil {
		slog.Error("generation task submit state could not be saved", "task_id", task.ID, "error", err)
		return
	}
	workflow.syncGenerationNotificationTask(submittingTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, action, submittingTask.Status, submittingTask.Message, nil)

	generationCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()

	response, err := workflow.generateWithProvider(
		generationCtx,
		provider,
		request,
		generationProviderLogContext{Action: action, TaskID: task.ID},
	)
	if err != nil {
		messageResponse := FailedGenerationResponse(task.ID, err)
		failedTask := GenerationTaskWithMessage(submittingTask, messageResponse)
		if saveErr := workflow.generationTasks.Upsert(failedTask); saveErr != nil {
			slog.Error("generation task submission failure could not be saved", "task_id", task.ID, "error", saveErr)
			return
		}
		workflow.syncGenerationNotificationTask(failedTask)
		_ = workflow.generationTasks.RecordAttempt(task.ID, action, messageResponse.Status, messageResponse.Message, err)
		if conversation, ok, getErr := workflow.generationTasks.GetConversation(task.ConversationID); getErr == nil && ok {
			workflow.appendStudioAssistantTranscript(conversation, messageResponse)
		}
		return
	}

	providerTaskID := strings.TrimSpace(response.ID)
	response = workflow.cacheGenerationResponseAssetsForScope(ctx, response, projectID, studioSessionID)
	messageResponse := GenerationResponseFromCore(response, task.Kind)
	messageResponse.ID = task.ID
	submittedTask := GenerationTaskWithMessage(submittingTask, messageResponse)
	if providerTaskID != "" {
		submittedTask.ProviderTaskID = providerTaskID
	}
	if err := workflow.generationTasks.Upsert(submittedTask); err != nil {
		slog.Error("generation task submission could not be saved", "task_id", task.ID, "error", err)
		return
	}
	workflow.syncGenerationNotificationTask(submittedTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, action, messageResponse.Status, messageResponse.Message, nil)
	if conversation, ok, err := workflow.generationTasks.GetConversation(task.ConversationID); err == nil && ok {
		workflow.appendStudioAssistantTranscript(conversation, messageResponse)
	}
}

func (workflow *GenerationService) completeSubmittedGeneration(
	ctx context.Context,
	task generationTaskRecord,
	provider coregeneration.Provider,
	request coregeneration.Request,
	action string,
	projectID string,
	studioSessionID string,
) {
	runningTask := task
	runningTask.Status = "running"
	runningTask.Message = "生成请求正在服务器上运行，可以安全刷新页面。"
	runningTask.Error = ""
	if err := workflow.generationTasks.Upsert(runningTask); err != nil {
		slog.Error("generation task running state could not be saved", "task_id", task.ID, "error", err)
		return
	}
	workflow.syncGenerationNotificationTask(runningTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, action, runningTask.Status, runningTask.Message, nil)

	generationCtx, cancel := context.WithTimeout(ctx, generationRequestTimeout)
	defer cancel()

	response, err := workflow.generateWithProvider(
		generationCtx,
		provider,
		request,
		generationProviderLogContext{Action: action, TaskID: task.ID},
	)
	if err != nil {
		messageResponse := FailedGenerationResponse(task.ID, err)
		failedTask := GenerationTaskWithMessage(runningTask, messageResponse)
		if saveErr := workflow.generationTasks.Upsert(failedTask); saveErr != nil {
			slog.Error("generation task failure could not be saved", "task_id", task.ID, "error", saveErr)
			return
		}
		workflow.syncGenerationNotificationTask(failedTask)
		_ = workflow.generationTasks.RecordAttempt(task.ID, action, messageResponse.Status, messageResponse.Message, err)
		if conversation, ok, getErr := workflow.generationTasks.GetConversation(task.ConversationID); getErr == nil && ok {
			workflow.appendStudioAssistantTranscript(conversation, messageResponse)
		}
		return
	}

	response = workflow.cacheGenerationResponseAssetsForScope(ctx, response, projectID, studioSessionID)
	messageResponse := GenerationResponseFromCore(response, task.Kind)
	messageResponse.ID = task.ID
	completedTask := GenerationTaskWithMessage(runningTask, messageResponse)
	if err := workflow.generationTasks.Upsert(completedTask); err != nil {
		slog.Error("generation task completion could not be saved", "task_id", task.ID, "error", err)
		return
	}
	workflow.syncGenerationNotificationTask(completedTask)
	_ = workflow.generationTasks.RecordAttempt(task.ID, action, messageResponse.Status, messageResponse.Message, nil)
	if conversation, ok, err := workflow.generationTasks.GetConversation(task.ConversationID); err == nil && ok {
		workflow.appendStudioAssistantTranscript(conversation, messageResponse)
	}
}
