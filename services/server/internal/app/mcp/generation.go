package mcp

import (
	"context"
	"fmt"
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

func (server *GenerationServer) ListGenerationModels(ctx context.Context, input mediamcp.GenerationListModelsInput) (mediamcp.GenerationModelsOutput, error) {
	_ = ctx
	service, err := server.requireService()
	if err != nil {
		return mediamcp.GenerationModelsOutput{}, err
	}
	kind := strings.TrimSpace(input.Kind)
	server.logToolInvocation(mediamcp.GenerationTools.ListModels.Name, "kind", kind)
	output := generationModelsOutputFromService(service.ListGenerationModels())
	output = filterGenerationModelsOutputByKind(output, kind)
	if preference, ok := service.GenerationPreferenceForProject(server.scopedProjectID("")); ok {
		output.Preferences = generationPreferencesFromService(preference)
	}
	return output, nil
}

// filterGenerationModelsOutputByKind narrows the catalog to one generation
// kind. The full catalog is ~300KB (654 voice previews alone); an image-only
// view is ~50KB, which matters because agents pay for the output in tokens.
func filterGenerationModelsOutputByKind(output mediamcp.GenerationModelsOutput, kind string) mediamcp.GenerationModelsOutput {
	if kind == "" {
		return output
	}
	filtered := output
	filtered.Families = nil
	for _, family := range output.Families {
		if string(family.Kind) == kind {
			filtered.Families = append(filtered.Families, family)
		}
	}
	filtered.Versions = nil
	for _, version := range output.Versions {
		if string(version.Kind) == kind {
			filtered.Versions = append(filtered.Versions, version)
		}
	}
	filtered.Routes = nil
	for _, route := range output.Routes {
		if string(route.Kind) == kind {
			filtered.Routes = append(filtered.Routes, route)
		}
	}
	filtered.Models = nil
	for _, model := range output.Models {
		if string(model.Kind) == kind {
			filtered.Models = append(filtered.Models, model)
		}
	}
	if kind != "audio" {
		filtered.VoicePreviews = nil
	}
	if kind != "image" {
		filtered.StylePresets = nil
	}
	return filtered
}

func (server *GenerationServer) CreateGenerationMessage(ctx context.Context, projectID string, input mediamcp.GenerationMessageInput) (mediamcp.GenerationMessageOutput, error) {
	service, err := server.requireService()
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	defaultProjectID, err := server.generationMessageProjectID(projectID, input)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	request := generationMessageRequestFromMCP(input, defaultProjectID)
	server.logToolInvocation(mediamcp.GenerationTools.Generate.Name, "kind", request.Kind, "route_id", request.RouteID, "optimize", request.PromptOptimization != nil)
	if request.PromptOptimization != nil {
		response, status, err := service.CreatePromptOptimizedGenerationMessage(ctx, request)
		if err != nil {
			return mediamcp.GenerationMessageOutput{}, generationStatusError("optimize and generate", status, err)
		}
		output := generationMessageOutputFromService(response.Generation)
		output.OptimizedPrompt = response.OptimizedPrompt
		return output, nil
	}
	response, status, err := service.CreateGenerationMessage(ctx, request)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, generationStatusError("create generation message", status, err)
	}
	return generationMessageOutputFromService(response), nil
}

func (server *GenerationServer) GetGenerationTask(ctx context.Context, projectID string, input mediamcp.GenerationTaskInput) (mediamcp.GenerationTaskRecord, error) {
	_ = ctx
	service, err := server.requireService()
	if err != nil {
		return mediamcp.GenerationTaskRecord{}, err
	}
	taskID, err := cleanGenerationTaskID(input.TaskID)
	if err != nil {
		return mediamcp.GenerationTaskRecord{}, err
	}
	server.logToolInvocation(mediamcp.GenerationTools.GetTask.Name, "task_id", taskID)
	task, ok, err := service.GetGenerationTask(taskID)
	if err != nil {
		return mediamcp.GenerationTaskRecord{}, err
	}
	effectiveProjectID, err := server.resolveProjectID(projectID)
	if err != nil {
		return mediamcp.GenerationTaskRecord{}, err
	}
	if !ok || !generationTaskVisibleToProject(task.ProjectID, effectiveProjectID) {
		return mediamcp.GenerationTaskRecord{}, fmt.Errorf("generation task not found")
	}
	return generationTaskRecordFromService(task), nil
}

func (server *GenerationServer) ListGenerationTasks(ctx context.Context, projectID string, input mediamcp.GenerationTaskListInput) (mediamcp.GenerationTasksOutput, error) {
	_ = ctx
	service, err := server.requireService()
	if err != nil {
		return mediamcp.GenerationTasksOutput{}, err
	}
	effectiveProjectID, err := server.resolveProjectID(projectID, input.ProjectID)
	if err != nil {
		return mediamcp.GenerationTasksOutput{}, err
	}
	server.logToolInvocation(mediamcp.GenerationTools.ListTasks.Name, "kind", input.Kind, "project_id", effectiveProjectID)
	tasks, err := service.ListGenerationTasks(servicegeneration.GenerationTaskListQuery{
		ConversationID: strings.TrimSpace(input.ConversationID),
		Kind:           strings.TrimSpace(input.Kind),
		ProjectID:      effectiveProjectID,
		ScopeID:        strings.TrimSpace(input.ScopeID),
		Limit:          input.Limit,
		Offset:         input.Offset,
	})
	if err != nil {
		return mediamcp.GenerationTasksOutput{}, err
	}
	return generationTasksOutputFromService(tasks), nil
}

func (server *GenerationServer) RetryGenerationTask(ctx context.Context, projectID string, input mediamcp.GenerationTaskInput) (mediamcp.GenerationMessageOutput, error) {
	service, task, err := server.serviceAndVisibleTask(projectID, input.TaskID)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	server.logToolInvocation(mediamcp.GenerationTools.RetryTask.Name, "task_id", task.ID)
	response, status, err := service.RetryGenerationTask(ctx, task.ID)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, generationStatusError("retry generation task", status, err)
	}
	return generationMessageOutputFromService(response), nil
}

func (server *GenerationServer) PollGenerationTask(ctx context.Context, projectID string, input mediamcp.GenerationTaskInput) (mediamcp.GenerationMessageOutput, error) {
	service, task, err := server.serviceAndVisibleTask(projectID, input.TaskID)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	server.logToolInvocation(mediamcp.GenerationTools.PollTask.Name, "task_id", task.ID)
	service.PollGenerationTask(ctx, task)
	latest, ok, err := service.GetGenerationTask(task.ID)
	if err != nil {
		return mediamcp.GenerationMessageOutput{}, err
	}
	if ok {
		task = latest
	}
	return generationMessageOutputFromService(servicegeneration.GenerationResponseFromTask(task)), nil
}

func (server *GenerationServer) SelectGenerationAsset(ctx context.Context, projectID string, input mediamcp.GenerationSelectAssetInput) (mediamcp.GenerationTaskRecord, error) {
	_ = ctx
	service, task, err := server.serviceAndVisibleTask(projectID, input.TaskID)
	if err != nil {
		return mediamcp.GenerationTaskRecord{}, err
	}
	if input.SlotIndex < 0 {
		return mediamcp.GenerationTaskRecord{}, fmt.Errorf("slotIndex must be >= 0")
	}
	server.logToolInvocation(mediamcp.GenerationTools.SelectAsset.Name, "task_id", task.ID, "slot_index", input.SlotIndex)
	selected := true
	patch := servicegeneration.UpdateGenerationTaskAssetRequest{Selected: &selected}
	if title := strings.TrimSpace(input.Title); title != "" {
		patch.Title = &title
	}
	if resourceType := strings.TrimSpace(input.ResourceType); resourceType != "" {
		patch.ResourceType = resourceType
	}
	updated, ok, err := service.UpdateGenerationTaskAsset(task.ID, input.SlotIndex, patch)
	if err != nil {
		return mediamcp.GenerationTaskRecord{}, err
	}
	if !ok {
		return mediamcp.GenerationTaskRecord{}, fmt.Errorf("generation asset slot %d not found", input.SlotIndex)
	}
	return generationTaskRecordFromService(updated), nil
}

func (server *GenerationServer) serviceAndVisibleTask(projectID string, rawTaskID string) (GenerationService, servicegeneration.GenerationTaskRecord, error) {
	service, err := server.requireService()
	if err != nil {
		return nil, servicegeneration.GenerationTaskRecord{}, err
	}
	taskID, err := cleanGenerationTaskID(rawTaskID)
	if err != nil {
		return nil, servicegeneration.GenerationTaskRecord{}, err
	}
	task, ok, err := service.GetGenerationTask(taskID)
	if err != nil {
		return nil, servicegeneration.GenerationTaskRecord{}, err
	}
	if !ok {
		return nil, servicegeneration.GenerationTaskRecord{}, fmt.Errorf("generation task not found")
	}
	effectiveProjectID, err := server.resolveProjectID(projectID)
	if err != nil {
		return nil, servicegeneration.GenerationTaskRecord{}, err
	}
	if !generationTaskVisibleToProject(task.ProjectID, effectiveProjectID) {
		return nil, servicegeneration.GenerationTaskRecord{}, fmt.Errorf("generation task not found")
	}
	return service, task, nil
}

func (server *GenerationServer) generationMessageProjectID(projectID string, input mediamcp.GenerationMessageInput) (string, error) {
	values := []string{input.ProjectID}
	if input.DocumentContext != nil {
		values = append(values, input.DocumentContext.ProjectID)
	}
	if input.NotificationTarget != nil {
		values = append(values, input.NotificationTarget.ProjectID)
	}
	if input.PromptOptimization != nil {
		values = append(values, input.PromptOptimization.ProjectID)
	}
	return server.resolveProjectID(projectID, values...)
}

func (server *GenerationServer) resolveProjectID(projectID string, overrides ...string) (string, error) {
	scopedProjectID := server.scopedProjectID(projectID)
	resolved := ""
	for _, override := range overrides {
		override = domain.CleanProjectID(override)
		if override == "" {
			continue
		}
		if scopedProjectID != "" && override != scopedProjectID {
			return "", fmt.Errorf("projectId %q is outside generation mcp scope %q", override, scopedProjectID)
		}
		if resolved != "" && override != resolved {
			return "", fmt.Errorf("conflicting projectId values: %q and %q", resolved, override)
		}
		resolved = override
	}
	if scopedProjectID != "" {
		return scopedProjectID, nil
	}
	return resolved, nil
}

func (server *GenerationServer) scopedProjectID(projectID string) string {
	if server == nil {
		return domain.CleanProjectID(projectID)
	}
	return domain.CleanProjectID(firstNonEmpty(projectID, server.projectID))
}

func cleanGenerationTaskID(taskID string) (string, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return "", fmt.Errorf("taskId is required")
	}
	return taskID, nil
}

func generationTaskVisibleToProject(taskProjectID string, projectID string) bool {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return true
	}
	taskProjectID = strings.TrimSpace(taskProjectID)
	return taskProjectID == "" || taskProjectID == projectID
}
