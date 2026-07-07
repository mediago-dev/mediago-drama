package mcp

import (
	"strings"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

func generationModelsOutputFromService(input servicegeneration.GenerationModelsResponse) mediamcp.GenerationModelsOutput {
	previews := make([]mediamcp.GenerationVoicePreviewAsset, 0, len(input.VoicePreviews))
	for _, preview := range input.VoicePreviews {
		previews = append(previews, mediamcp.GenerationVoicePreviewAsset{
			RouteID:  preview.RouteID,
			VoiceID:  preview.VoiceID,
			URL:      preview.URL,
			MIMEType: preview.MIMEType,
		})
	}
	return mediamcp.GenerationModelsOutput{
		Families:      input.Families,
		Versions:      input.Versions,
		Routes:        input.Routes,
		Models:        input.Models,
		Providers:     input.Providers,
		VoicePreviews: previews,
	}
}

func generationMessageRequestFromMCP(input mediamcp.GenerationMessageInput, defaultProjectID string) servicegeneration.GenerationMessageRequest {
	request := servicegeneration.GenerationMessageRequest{
		Kind:              strings.TrimSpace(input.Kind),
		ConversationID:    strings.TrimSpace(input.ConversationID),
		ScopeID:           strings.TrimSpace(input.ScopeID),
		ProjectID:         firstNonEmpty(input.ProjectID, defaultProjectID),
		DocumentID:        strings.TrimSpace(input.DocumentID),
		SectionID:         strings.TrimSpace(input.SectionID),
		CapabilityID:      strings.TrimSpace(input.CapabilityID),
		RouteID:           strings.TrimSpace(input.RouteID),
		FamilyID:          strings.TrimSpace(input.FamilyID),
		VersionID:         strings.TrimSpace(input.VersionID),
		Provider:          strings.TrimSpace(input.Provider),
		ModelID:           strings.TrimSpace(input.ModelID),
		Model:             strings.TrimSpace(input.Model),
		Prompt:            strings.TrimSpace(input.Prompt),
		AssetTitle:        strings.TrimSpace(input.AssetTitle),
		ReferenceURLs:     append([]string(nil), input.ReferenceURLs...),
		ReferenceAssetIDs: append([]string(nil), input.ReferenceAssetIDs...),
		ReferenceBindings: generationReferenceBindingsFromMCP(input.ReferenceBindings),
		Params:            input.Params,
	}
	if input.DocumentContext != nil {
		request.DocumentContext = generationDocumentContextFromMCP(input.DocumentContext, defaultProjectID)
	}
	if input.NotificationTarget != nil {
		request.NotificationTarget = generationNotificationTargetFromMCP(input.NotificationTarget, defaultProjectID)
	}
	if input.PromptOptimization != nil {
		request.PromptOptimization = generationPromptOptimizationFromMCP(input.PromptOptimization, defaultProjectID)
	}
	return request
}

func generationDocumentContextFromMCP(input *mediamcp.GenerationDocumentContext, defaultProjectID string) *servicegeneration.GenerationDocumentContext {
	if input == nil {
		return nil
	}
	return &servicegeneration.GenerationDocumentContext{
		ProjectID:  firstNonEmpty(input.ProjectID, defaultProjectID),
		DocumentID: strings.TrimSpace(input.DocumentID),
		SectionID:  strings.TrimSpace(input.SectionID),
	}
}

func generationReferenceBindingsFromMCP(input []mediamcp.GenerationReferenceBinding) []servicegeneration.GenerationReferenceBinding {
	if len(input) == 0 {
		return nil
	}
	output := make([]servicegeneration.GenerationReferenceBinding, 0, len(input))
	for _, binding := range input {
		output = append(output, servicegeneration.GenerationReferenceBinding{
			Kind:       strings.TrimSpace(binding.Kind),
			DocumentID: strings.TrimSpace(binding.DocumentID),
			BlockID:    strings.TrimSpace(binding.BlockID),
			AssetID:    strings.TrimSpace(binding.AssetID),
			URL:        strings.TrimSpace(binding.URL),
		})
	}
	return output
}

func generationPromptOptimizationFromMCP(input *mediamcp.GenerationPromptOptimizationInput, defaultProjectID string) *servicegeneration.GenerationPromptOptimizationRequest {
	if input == nil {
		return nil
	}
	return &servicegeneration.GenerationPromptOptimizationRequest{
		ConversationID:    strings.TrimSpace(input.ConversationID),
		ScopeID:           strings.TrimSpace(input.ScopeID),
		ConversationTitle: strings.TrimSpace(input.ConversationTitle),
		ProjectID:         firstNonEmpty(input.ProjectID, defaultProjectID),
		CapabilityID:      strings.TrimSpace(input.CapabilityID),
		RouteID:           strings.TrimSpace(input.RouteID),
		Model:             strings.TrimSpace(input.Model),
		ReferenceName:     strings.TrimSpace(input.ReferenceName),
		ReferencePrompt:   strings.TrimSpace(input.ReferencePrompt),
		Params:            input.Params,
	}
}

func generationNotificationTargetFromMCP(input *mediamcp.GenerationNotificationTarget, defaultProjectID string) *servicegeneration.GenerationNotificationTarget {
	if input == nil {
		return nil
	}
	return &servicegeneration.GenerationNotificationTarget{
		Kind:          strings.TrimSpace(input.Kind),
		ProjectID:     firstNonEmpty(input.ProjectID, defaultProjectID),
		DocumentID:    strings.TrimSpace(input.DocumentID),
		DocumentTitle: strings.TrimSpace(input.DocumentTitle),
		Section: servicegeneration.GenerationNotificationSectionTarget{
			BlockID:           strings.TrimSpace(input.Section.BlockID),
			DocumentID:        strings.TrimSpace(input.Section.DocumentID),
			HeadingLevel:      input.Section.HeadingLevel,
			HeadingOccurrence: input.Section.HeadingOccurrence,
			HeadingText:       strings.TrimSpace(input.Section.HeadingText),
			Markdown:          input.Section.Markdown,
			PlainText:         input.Section.PlainText,
			Prompt:            input.Section.Prompt,
		},
	}
}

func generationMessageOutputFromService(input servicegeneration.GenerationMessageResponse) mediamcp.GenerationMessageOutput {
	return mediamcp.GenerationMessageOutput{
		ID:        input.ID,
		Role:      input.Role,
		Status:    input.Status,
		Message:   input.Message,
		Text:      input.Text,
		Assets:    generationAssetsFromService(input.Assets),
		Usage:     generationUsageFromService(input.Usage),
		Error:     input.Error,
		ErrorCode: input.ErrorCode,
		ErrorType: input.ErrorType,
		Retryable: input.Retryable,
	}
}

func generationTasksOutputFromService(input servicegeneration.GenerationTasksResponse) mediamcp.GenerationTasksOutput {
	tasks := make([]mediamcp.GenerationTaskRecord, 0, len(input.Tasks))
	for _, task := range input.Tasks {
		tasks = append(tasks, generationTaskRecordFromService(task))
	}
	return mediamcp.GenerationTasksOutput{Tasks: tasks}
}

func generationTaskRecordFromService(input servicegeneration.GenerationTaskRecord) mediamcp.GenerationTaskRecord {
	return mediamcp.GenerationTaskRecord{
		ID:                input.ID,
		ProviderTaskID:    input.ProviderTaskID,
		ConversationID:    input.ConversationID,
		ProjectID:         input.ProjectID,
		DocumentID:        input.DocumentID,
		SectionID:         input.SectionID,
		CapabilityID:      input.CapabilityID,
		Kind:              input.Kind,
		RouteID:           input.RouteID,
		FamilyID:          input.FamilyID,
		VersionID:         input.VersionID,
		Provider:          input.Provider,
		ModelID:           input.ModelID,
		Model:             input.Model,
		Prompt:            input.Prompt,
		ReferenceURLs:     append([]string(nil), input.ReferenceURLs...),
		ReferenceAssetIDs: append([]string(nil), input.ReferenceAssetIDs...),
		Params:            input.Params,
		Status:            input.Status,
		Message:           input.Message,
		Text:              input.Text,
		Assets:            generationAssetsFromService(input.Assets),
		DeletedAssetSlots: append([]int(nil), input.DeletedAssetSlots...),
		Usage:             generationUsageFromService(input.Usage),
		Error:             input.Error,
		ErrorCode:         input.ErrorCode,
		ErrorType:         input.ErrorType,
		Retryable:         input.Retryable,
		CreatedAt:         input.CreatedAt,
		UpdatedAt:         input.UpdatedAt,
		DurationMS:        input.DurationMS,
		Attempts:          generationTaskAttemptsFromService(input.Attempts),
		RetryCount:        input.RetryCount,
		LastAttemptAt:     input.LastAttemptAt,
	}
}

func generationAssetsFromService(input []servicegeneration.GenerationAsset) []mediamcp.GenerationAsset {
	if len(input) == 0 {
		return nil
	}
	output := make([]mediamcp.GenerationAsset, 0, len(input))
	for _, asset := range input {
		output = append(output, mediamcp.GenerationAsset{
			AssetID:      asset.AssetID,
			Kind:         asset.Kind,
			TaskID:       asset.TaskID,
			Title:        asset.Title,
			URL:          asset.URL,
			PosterURL:    asset.PosterURL,
			Base64:       asset.Base64,
			MIMEType:     asset.MIMEType,
			DownloadPath: asset.DownloadPath,
			SlotIndex:    asset.SlotIndex,
			Selected:     asset.Selected,
		})
	}
	return output
}

func generationUsageFromService(input servicegeneration.GenerationUsage) mediamcp.GenerationUsage {
	return mediamcp.GenerationUsage{
		InputTokens:     input.InputTokens,
		OutputTokens:    input.OutputTokens,
		TotalTokens:     input.TotalTokens,
		ReasoningTokens: input.ReasoningTokens,
		CachedTokens:    input.CachedTokens,
	}
}

func generationTaskAttemptsFromService(input []servicegeneration.GenerationTaskAttemptRecord) []mediamcp.GenerationTaskAttemptRecord {
	if len(input) == 0 {
		return nil
	}
	output := make([]mediamcp.GenerationTaskAttemptRecord, 0, len(input))
	for _, attempt := range input {
		output = append(output, mediamcp.GenerationTaskAttemptRecord{
			ID:        attempt.ID,
			TaskID:    attempt.TaskID,
			Action:    attempt.Action,
			Status:    attempt.Status,
			Message:   attempt.Message,
			Error:     attempt.Error,
			CreatedAt: attempt.CreatedAt,
		})
	}
	return output
}
