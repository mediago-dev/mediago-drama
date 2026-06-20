package media

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const mediaAssetDateDirLayout = "2006-01-02"

type mediaAssetTargetLocation struct {
	Directory   string
	RelativeDir string
}

func normalizeMediaAssetSaveOptions(options MediaAssetSaveOptions) MediaAssetSaveOptions {
	options.ProjectID = domain.CleanProjectID(options.ProjectID)
	options.Source = normalizeMediaAssetSource(options.Source)
	conversationID := strings.TrimSpace(options.ConversationID)
	options.ConversationID = ""
	if conversationID != "" {
		options.ConversationID = shared.AssetPathSegment(conversationID, "conversation")
	}
	if strings.EqualFold(options.ConversationID, "ungrouped") {
		options.ConversationID = ""
	}
	options.SectionID = strings.TrimSpace(options.SectionID)
	return options
}

func normalizeMediaAssetSource(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case MediaSourceUpload:
		return MediaSourceUpload
	case MediaSourceToolbox:
		return MediaSourceToolbox
	case MediaSourcePreview:
		return MediaSourcePreview
	case MediaSourceGeneration:
		return MediaSourceGeneration
	default:
		return MediaSourceGeneration
	}
}

func (store *MediaAssets) targetLocation(options MediaAssetSaveOptions, dateDir string) (mediaAssetTargetLocation, error) {
	dateDir = strings.TrimSpace(dateDir)
	if dateDir == "" {
		dateDir = mediaAssetDateDirForTime(time.Now())
	}
	if options.ProjectID != "" {
		projectDir, err := store.projectDir(options.ProjectID)
		if err != nil {
			return mediaAssetTargetLocation{}, err
		}
		relativeDir := filepath.Join("library", dateDir)
		return mediaAssetTargetLocation{
			Directory:   filepath.Join(projectDir, relativeDir),
			RelativeDir: filepath.ToSlash(relativeDir),
		}, nil
	}

	baseDir := strings.TrimSpace(store.dir)
	if baseDir == "" {
		if strings.TrimSpace(store.workspaceRoot) != "" {
			baseDir = shared.WorkspacePathsFor(store.workspaceRoot).LibraryAssetsDir()
		} else {
			baseDir = defaultMediaDir()
		}
	}
	relativeDir := filepath.Join("library", dateDir)
	storageSubdir := strings.TrimPrefix(relativeDir, "library")
	storageSubdir = strings.TrimPrefix(storageSubdir, string(filepath.Separator))
	directory := filepath.Join(baseDir, storageSubdir)
	return mediaAssetTargetLocation{
		Directory:   filepath.Clean(directory),
		RelativeDir: filepath.ToSlash(relativeDir),
	}, nil
}

func mediaAssetDateDirForTime(value time.Time) string {
	return value.Local().Format(mediaAssetDateDirLayout)
}

func mediaAssetDateDirFromTimestamp(value string) string {
	if parsed, err := timestamp.ParseRFC3339Nano(value); err == nil {
		return mediaAssetDateDirForTime(parsed)
	}
	return mediaAssetDateDirForTime(time.Now())
}

func (store *MediaAssets) projectDir(projectID string) (string, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return "", fmt.Errorf("project id is required")
	}
	if store.workspaceRepo != nil {
		project, err := store.workspaceRepo.GetProject(projectID)
		if repository.IsRecordNotFound(err) {
			return "", fmt.Errorf("project %s was not found", projectID)
		}
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(project.ProjectDir) == "" {
			return "", fmt.Errorf("project %s has no project directory", projectID)
		}
		return shared.ResolveWorkspaceDir(project.ProjectDir), nil
	}
	if strings.TrimSpace(store.workspaceRoot) == "" {
		return "", errors.New("workspace root is required for project media")
	}
	return shared.WorkspacePathsFor(store.workspaceRoot).AgentDir(projectID), nil
}

func (store *MediaAssets) allowedRootsForAsset(asset MediaAsset) []string {
	roots := []string{store.dir, store.workspaceRoot}
	if strings.TrimSpace(asset.ProjectID) != "" {
		if projectDir, err := store.projectDir(asset.ProjectID); err == nil && projectDir != "" {
			roots = append(roots, projectDir)
		}
	}
	seen := map[string]struct{}{}
	unique := make([]string, 0, len(roots))
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if _, ok := seen[root]; ok {
			continue
		}
		seen[root] = struct{}{}
		unique = append(unique, root)
	}
	return unique
}

// SectionAssetPathSegments parses documentId:blockId into safe directory segments.
func SectionAssetPathSegments(sectionID string) (string, string) {
	documentID, blockID, ok := strings.Cut(strings.TrimSpace(sectionID), ":")
	if !ok {
		return "ungrouped", shared.AssetPathSegment(sectionID, "section")
	}
	return shared.AssetPathSegment(documentID, "document"), shared.AssetPathSegment(blockID, "block")
}

func joinAssetRelativePath(relativeDir string, filename string) string {
	relativeDir = strings.TrimSpace(relativeDir)
	filename = strings.TrimSpace(filename)
	if relativeDir == "" {
		return filepath.ToSlash(filename)
	}
	return filepath.ToSlash(filepath.Join(relativeDir, filename))
}
