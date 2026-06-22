package generation

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
)

func (workflow *GenerationService) resolveGenerationReferences(
	route coregeneration.ModelRoute,
	request generationMessageRequest,
) ([]string, error) {
	if !route.SupportsReferenceURLs {
		return []string{}, nil
	}

	references, referenceAssetIDs := splitReferenceURLs(request.ReferenceURLs)
	for _, assetID := range uniqueCompactStrings(append(referenceAssetIDs, request.ReferenceAssetIDs...)) {
		asset, ok, err := workflow.mediaAssets.Get(assetID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("media asset %q was not found", assetID)
		}
		if asset.Kind != string(coregeneration.KindImage) && asset.Kind != string(coregeneration.KindVideo) {
			return nil, fmt.Errorf("media asset %q is not a supported reference", assetID)
		}
		if route.Kind == coregeneration.KindImage && asset.Kind != string(coregeneration.KindImage) {
			return nil, fmt.Errorf("media asset %q is not an image reference", assetID)
		}
		if asset.Kind == string(coregeneration.KindVideo) && route.Adapter != coregeneration.AdapterOpenRouterVideo {
			return nil, fmt.Errorf("media asset %q is not supported as a video reference for this route", assetID)
		}

		reference := asset.URL
		if route.Kind == coregeneration.KindImage && asset.Kind == string(coregeneration.KindImage) {
			reference, err = workflow.mediaAssets.CompressedImageDataURIValue(
				asset,
				media.DefaultReferenceImageCompressionOptions(),
			)
		} else {
			reference, err = workflow.mediaAssets.DataURIValue(asset)
		}
		if err != nil {
			return nil, fmt.Errorf("reading media asset %q: %w", assetID, err)
		}
		references = append(references, reference)
	}

	return references, nil
}

func splitReferenceURLs(values []string) ([]string, []string) {
	referenceURLs := []string{}
	assetIDs := []string{}
	seenReferenceURLs := map[string]struct{}{}
	seenAssetIDs := map[string]struct{}{}

	for _, value := range CompactStrings(values) {
		if assetID := libraryAssetIDFromGenerationAssetURL(value); assetID != "" {
			if _, exists := seenAssetIDs[assetID]; exists {
				continue
			}

			seenAssetIDs[assetID] = struct{}{}
			assetIDs = append(assetIDs, assetID)
			continue
		}

		if _, exists := seenReferenceURLs[value]; exists {
			continue
		}

		seenReferenceURLs[value] = struct{}{}
		referenceURLs = append(referenceURLs, value)
	}

	return referenceURLs, assetIDs
}

func uniqueCompactStrings(values []string) []string {
	result := []string{}
	seen := map[string]struct{}{}
	for _, value := range CompactStrings(values) {
		if _, exists := seen[value]; exists {
			continue
		}

		seen[value] = struct{}{}
		result = append(result, value)
	}

	return result
}

func (workflow *GenerationService) cacheGenerationResponseAssets(
	ctx context.Context,
	response coregeneration.Response,
	projectID string,
) coregeneration.Response {
	return workflow.cacheGenerationResponseAssetsWithOptions(ctx, response, generationMediaSaveOptions(projectID, "", ""))
}

func (workflow *GenerationService) cacheGenerationResponseAssetsForScope(
	ctx context.Context,
	response coregeneration.Response,
	projectID string,
	conversationID string,
) coregeneration.Response {
	return workflow.cacheGenerationResponseAssetsWithOptions(ctx, response, generationMediaSaveOptions(projectID, conversationID, ""))
}

func (workflow *GenerationService) cacheGenerationResponseAssetsForTask(
	ctx context.Context,
	response coregeneration.Response,
	task generationTaskRecord,
) coregeneration.Response {
	return workflow.cacheGenerationResponseAssetsWithOptions(ctx, response, generationMediaSaveOptions(
		workflow.projectIDForTask(task),
		task.ConversationID,
		task.SectionID,
	))
}

func (workflow *GenerationService) cacheGenerationResponseAssetsWithOptions(
	ctx context.Context,
	response coregeneration.Response,
	options media.MediaAssetSaveOptions,
) coregeneration.Response {
	if workflow.mediaAssets == nil || len(response.Assets) == 0 {
		return response
	}

	warnings := []string{}
	for index, asset := range response.Assets {
		cached, err := workflow.cacheGenerationAsset(ctx, asset, options)
		if err != nil {
			warnings = append(warnings, err.Error())
			slog.Warn(
				"generation asset cache failed",
				"response_id", response.ID,
				"model", response.Model,
				"asset_kind", asset.Kind,
				"asset_url", asset.URL,
				"error", err,
			)
			continue
		}
		if cached.ID == "" {
			continue
		}

		response.Assets[index].URL = cached.URL
		response.Assets[index].Base64 = ""
		response.Assets[index].MIMEType = cached.MIMEType
	}
	if len(warnings) > 0 {
		if response.Metadata == nil {
			response.Metadata = map[string]any{}
		}
		response.Metadata["asset_cache_warnings"] = warnings
	}

	return response
}

// CacheGenerationResponseAssets stores generated assets in the local media store when possible.
func (workflow *GenerationService) CacheGenerationResponseAssets(
	ctx context.Context,
	response coregeneration.Response,
) coregeneration.Response {
	return workflow.cacheGenerationResponseAssets(ctx, response, "")
}

func (workflow *GenerationService) cacheGenerationAsset(
	ctx context.Context,
	asset coregeneration.Asset,
	options media.MediaAssetSaveOptions,
) (media.MediaAsset, error) {
	kind := string(asset.Kind)
	if asset.Base64 != "" {
		cached, err := workflow.mediaAssets.SaveBase64WithOptions(kind, asset.MIMEType, asset.Base64, "", options)
		if err != nil {
			return media.MediaAsset{}, fmt.Errorf("saving base64 asset: %w", err)
		}

		return cached, nil
	}
	if asset.URL == "" || isLocalMediaAssetURL(asset.URL) {
		return media.MediaAsset{}, nil
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(asset.URL)), "data:") {
		cached, err := workflow.mediaAssets.SaveBase64WithOptions(kind, asset.MIMEType, asset.URL, "", options)
		if err != nil {
			return media.MediaAsset{}, fmt.Errorf("saving data uri asset: %w", err)
		}

		return cached, nil
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(asset.URL)), "http://") &&
		!strings.HasPrefix(strings.ToLower(strings.TrimSpace(asset.URL)), "https://") {
		return media.MediaAsset{}, fmt.Errorf("unsupported generated asset url %q", asset.URL)
	}

	cached, err := workflow.mediaAssets.SaveRemoteAssetWithOptions(ctx, kind, asset.URL, options)
	if err != nil {
		return media.MediaAsset{}, fmt.Errorf("caching remote asset: %w", err)
	}

	return cached, nil
}

func isLocalMediaAssetURL(value string) bool {
	return libraryAssetIDFromGenerationAssetURL(value) != ""
}

func generationMediaSaveOptions(projectID string, conversationID string, sectionID string) media.MediaAssetSaveOptions {
	source := media.MediaSourceGeneration
	if strings.TrimSpace(projectID) == "" && strings.TrimSpace(conversationID) != "" {
		source = media.MediaSourceToolbox
	}
	return media.MediaAssetSaveOptions{
		ProjectID:      projectID,
		Source:         source,
		ConversationID: conversationID,
		SectionID:      sectionID,
	}
}

func (workflow *GenerationService) saveGenerationBase64Asset(kind string, mimeType string, value string, sourceURL string, projectID string, conversationID string) (media.MediaAsset, error) {
	return workflow.mediaAssets.SaveBase64WithOptions(kind, mimeType, value, sourceURL, generationMediaSaveOptions(projectID, conversationID, ""))
}

func (workflow *GenerationService) saveGenerationRemoteAsset(ctx context.Context, kind string, remoteURL string, projectID string, conversationID string) (media.MediaAsset, error) {
	return workflow.mediaAssets.SaveRemoteAssetWithOptions(ctx, kind, remoteURL, generationMediaSaveOptions(projectID, conversationID, ""))
}

func (workflow *GenerationService) projectIDForConversation(conversationID string) string {
	if workflow == nil || workflow.generationTasks == nil {
		return ""
	}
	conversation, ok, err := workflow.generationTasks.GetConversation(strings.TrimSpace(conversationID))
	if err != nil || !ok {
		return ""
	}
	return GenerationProjectIDFromScopeID(conversation.ScopeID)
}

func (workflow *GenerationService) projectIDForTask(task generationTaskRecord) string {
	if projectID := GenerationProjectIDForRequest(task.ProjectID, ""); projectID != "" {
		return projectID
	}
	return workflow.projectIDForConversation(task.ConversationID)
}

func (workflow *GenerationService) studioSessionIDForConversation(conversation GenerationConversationRecord, projectID string) string {
	if strings.TrimSpace(projectID) != "" || !isFileBackedGenerationConversation(conversation) {
		return ""
	}
	return domain.CleanProjectID(conversation.ID)
}

func (workflow *GenerationService) studioDirForSessionID(sessionID string) string {
	if workflow == nil || workflow.generationTasks == nil {
		return ""
	}
	conversation, ok, err := workflow.generationTasks.GetConversation(domain.CleanProjectID(sessionID))
	if err != nil || !ok {
		return ""
	}
	return workflow.ensureStudioSessionDir(conversation)
}

func (workflow *GenerationService) studioSessionIDForTask(task generationTaskRecord) string {
	if workflow == nil || workflow.generationTasks == nil {
		return ""
	}
	if workflow.projectIDForTask(task) != "" {
		return ""
	}
	conversation, ok, err := workflow.generationTasks.GetConversation(strings.TrimSpace(task.ConversationID))
	if err != nil || !ok {
		return ""
	}
	return workflow.studioSessionIDForConversation(conversation, "")
}
