package generation

import (
	"fmt"
	"net/http"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	importedMediaGenerationRouteID        = "media-library"
	importedMediaGenerationDetailsParamID = "_mediago_request_details"
)

// ImportGenerationMediaAssets imports existing media library images into one
// generation conversation as completed, reference-only history records.
func (workflow *GenerationService) ImportGenerationMediaAssets(payload ImportGenerationMediaAssetsRequest) (GenerationTasksResponse, int, error) {
	if workflow.generationTasks == nil || workflow.mediaAssets == nil {
		return GenerationTasksResponse{}, http.StatusInternalServerError, fmt.Errorf("generation import service is not configured")
	}

	kind := strings.TrimSpace(payload.Kind)
	if kind == "" {
		kind = string(coregeneration.KindImage)
	}
	if kind != string(coregeneration.KindImage) {
		return GenerationTasksResponse{}, http.StatusBadRequest, fmt.Errorf("only image media assets can be imported into image generation history")
	}

	assetIDs := CompactStrings(payload.AssetIDs)
	if len(assetIDs) == 0 {
		return GenerationTasksResponse{}, http.StatusBadRequest, fmt.Errorf("media asset ids are required")
	}

	payload.ConversationID = strings.TrimSpace(payload.ConversationID)
	hasScopeFilter := strings.TrimSpace(payload.ScopeID) != ""
	payload.ScopeID = NormalizeGenerationConversationScopeID(payload.ScopeID)
	payload.ProjectID = GenerationProjectIDForRequest(payload.ProjectID, "")
	if strings.TrimSpace(payload.ConversationTitle) != "" &&
		payload.ConversationID != "" &&
		strings.TrimSpace(payload.ScopeID) != "" {
		_, status, err := workflow.CreateGenerationConversation(CreateGenerationConversationRequest{
			ID:      payload.ConversationID,
			ScopeID: payload.ScopeID,
			Kind:    kind,
			Title:   payload.ConversationTitle,
		})
		if err != nil {
			return GenerationTasksResponse{}, status, err
		}
	}

	conversation, status, err := workflow.resolveGenerationConversationWithScopeFilter(
		payload.ConversationID,
		payload.ScopeID,
		kind,
		hasScopeFilter,
	)
	if err != nil {
		return GenerationTasksResponse{}, status, err
	}
	if payload.ProjectID == "" {
		payload.ProjectID = GenerationProjectIDFromScopeID(conversation.ScopeID)
	}

	tasks := make([]GenerationTaskRecord, 0, len(assetIDs))
	for _, assetID := range assetIDs {
		asset, ok, err := workflow.mediaAssets.Get(assetID)
		if err != nil {
			return GenerationTasksResponse{}, http.StatusInternalServerError, err
		}
		if !ok || !mediaAssetMatchesGenerationProject(asset.ProjectID, payload.ProjectID) {
			return GenerationTasksResponse{}, http.StatusNotFound, fmt.Errorf("media asset %q was not found", assetID)
		}
		if asset.Kind != string(coregeneration.KindImage) {
			return GenerationTasksResponse{}, http.StatusBadRequest, fmt.Errorf("media asset %q is not an image", assetID)
		}

		taskID, err := workflow.generationTasks.idGenerator("media-library")
		if err != nil {
			return GenerationTasksResponse{}, http.StatusInternalServerError, err
		}
		title := strings.TrimSpace(payload.AssetTitle)
		if title == "" {
			title = strings.TrimSpace(asset.Filename)
		}
		if title == "" {
			title = "素材库图片"
		}
		prompt := strings.TrimSpace(payload.Prompt)
		if prompt == "" {
			prompt = "从素材库导入：" + title
		}

		task := GenerationTaskRecord{
			ID:                taskID,
			ConversationID:    conversation.ID,
			ProjectID:         payload.ProjectID,
			DocumentID:        strings.TrimSpace(payload.DocumentID),
			SectionID:         strings.TrimSpace(payload.SectionID),
			CapabilityID:      importedMediaGenerationCapabilityID(payload.CapabilityID),
			Kind:              kind,
			RouteID:           importedMediaGenerationRouteID,
			FamilyID:          importedMediaGenerationRouteID,
			VersionID:         importedMediaGenerationRouteID,
			Provider:          importedMediaGenerationRouteID,
			ModelID:           importedMediaGenerationRouteID,
			Model:             "素材库",
			Prompt:            prompt,
			ReferenceAssetIDs: []string{asset.ID},
			Params: map[string]any{
				importedMediaGenerationDetailsParamID: []map[string]string{
					{"label": "来源", "value": "素材库"},
					{"label": "文件", "value": asset.Filename},
				},
			},
			Status:  "completed",
			Message: "已从素材库导入。",
			Assets: []GenerationAsset{
				{
					Kind:         asset.Kind,
					Title:        title,
					URL:          asset.URL,
					MIMEType:     asset.MIMEType,
					DownloadPath: asset.DownloadPath,
					Selected:     false,
				},
			},
			Usage: GenerationUsage{},
		}
		if err := workflow.generationTasks.Upsert(task); err != nil {
			return GenerationTasksResponse{}, http.StatusInternalServerError, err
		}
		storedTask, ok, err := workflow.generationTasks.Get(taskID)
		if err != nil {
			return GenerationTasksResponse{}, http.StatusInternalServerError, err
		}
		if ok {
			tasks = append(tasks, GenerationTaskForClient(storedTask))
		}
	}

	return GenerationTasksResponse{Tasks: tasks}, http.StatusOK, nil
}

func importedMediaGenerationCapabilityID(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "image.generate"
}

func mediaAssetMatchesGenerationProject(assetProjectID string, requestProjectID string) bool {
	assetProjectID = GenerationProjectIDForRequest(assetProjectID, "")
	requestProjectID = GenerationProjectIDForRequest(requestProjectID, "")
	return requestProjectID == "" || assetProjectID == "" || assetProjectID == requestProjectID
}
