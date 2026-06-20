package media

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

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

func (store *MediaAssets) targetLocation(kind string, options MediaAssetSaveOptions) (mediaAssetTargetLocation, error) {
	kindDir := shared.AssetKindDirName(kind)
	if options.ProjectID != "" {
		projectDir, err := store.projectDir(options.ProjectID)
		if err != nil {
			return mediaAssetTargetLocation{}, err
		}
		relativeDir := filepath.Join("library", "assets", kindDir)
		if kind == MediaKindImage && options.Source == MediaSourceGeneration && strings.TrimSpace(options.SectionID) != "" {
			documentID, blockID := SectionAssetPathSegments(options.SectionID)
			relativeDir = filepath.Join(relativeDir, documentID, blockID)
		} else if options.Source == MediaSourceUpload {
			relativeDir = filepath.Join(relativeDir, "uploads")
		} else if options.ConversationID != "" {
			relativeDir = filepath.Join(relativeDir, "generation", options.ConversationID)
		} else {
			relativeDir = filepath.Join(relativeDir, "generation")
		}
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
	relativeDir := filepath.Join("library", "assets", kindDir)
	switch {
	case options.Source == MediaSourceUpload:
		relativeDir = filepath.Join(relativeDir, "uploads")
	case options.Source == MediaSourcePreview:
		relativeDir = filepath.Join(relativeDir, "previews")
	case options.Source == MediaSourceToolbox && options.ConversationID != "":
		relativeDir = filepath.Join(relativeDir, "toolbox", options.ConversationID)
	case options.Source == MediaSourceToolbox:
		relativeDir = filepath.Join(relativeDir, "toolbox")
	case options.ConversationID != "":
		relativeDir = filepath.Join(relativeDir, "generation", options.ConversationID)
	default:
		relativeDir = filepath.Join(relativeDir, "uploads")
	}
	storageSubdir := strings.TrimPrefix(relativeDir, filepath.Join("library", "assets"))
	storageSubdir = strings.TrimPrefix(storageSubdir, string(filepath.Separator))
	directory := filepath.Join(baseDir, storageSubdir)
	return mediaAssetTargetLocation{
		Directory:   filepath.Clean(directory),
		RelativeDir: filepath.ToSlash(relativeDir),
	}, nil
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
