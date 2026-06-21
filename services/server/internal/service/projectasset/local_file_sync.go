package projectasset

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

type localWorkAssetFile struct {
	RelativePath string
	Dir          string
	Path         string
	Filename     string
	Kind         string
	MIMEType     string
	SizeBytes    int64
	UpdatedAt    string
}

func (store *ProjectAssets) syncProjectWorkAssetsUnlocked(projectID string) error {
	dir := store.projectAssetDir(projectID)
	if dir == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating project work directory for assets: %w", err)
	}
	files, err := scanProjectWorkAssetFiles(dir)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}

	folderIDByDir, err := store.syncProjectWorkAssetFolders(projectID, files)
	if err != nil {
		return err
	}

	models, err := store.repo.ListProjectAssets(projectID)
	if err != nil {
		return err
	}
	modelByPath := map[string]projectReferenceAssetModel{}
	usedIDs := map[string]bool{}
	nextSortOrder := 0
	for _, model := range models {
		modelByPath[filepath.Clean(store.projectReferenceAssetModelFilePath(model))] = model
		usedIDs[model.ID] = true
		if model.SortOrder >= nextSortOrder {
			nextSortOrder = model.SortOrder + 1
		}
	}

	for _, file := range files {
		folderID := folderIDByDir[strings.ToLower(filepath.ToSlash(file.Dir))]
		if existing, ok := modelByPath[filepath.Clean(file.Path)]; ok {
			updates := map[string]any{}
			if existing.Asset.Filename != file.Filename {
				updates["filename"] = file.Filename
			}
			if existing.Asset.Kind != file.Kind {
				updates["kind"] = file.Kind
			}
			if existing.Asset.MIMEType != file.MIMEType {
				updates["mime_type"] = file.MIMEType
			}
			if existing.Asset.SizeBytes != file.SizeBytes {
				updates["size_bytes"] = file.SizeBytes
			}
			if domain.StringValue(existing.FolderID) != folderID {
				updates["folder_id"] = domain.StringPtr(folderID)
			}
			if domain.StringFromTime(existing.UpdatedAt) != file.UpdatedAt {
				updates["updated_at"] = domain.TimeFromString(file.UpdatedAt)
			}
			if len(updates) > 0 {
				if _, err := store.repo.UpdateProjectAsset(projectID, existing.ID, updates); err != nil {
					return err
				}
			}
			continue
		}

		id := uniqueProjectWorkFileID("asset-file-", projectID, file.RelativePath, usedIDs)
		relPath := store.projectAssetRelPath(projectID, file.Path)
		if err := store.repo.CreateProjectAsset(projectReferenceAssetModel{
			ProjectID: projectID,
			ID:        id,
			AssetID:   id,
			FolderID:  domain.StringPtr(folderID),
			SortOrder: nextSortOrder,
			CreatedAt: domain.TimeFromString(file.UpdatedAt),
			UpdatedAt: domain.TimeFromString(file.UpdatedAt),
			Asset: domain.AssetModel{
				ID:            id,
				ProjectID:     domain.StringPtr(projectID),
				Kind:          file.Kind,
				Filename:      file.Filename,
				MIMEType:      file.MIMEType,
				SizeBytes:     file.SizeBytes,
				RelPath:       relPath,
				URL:           projectAssetContentURL(projectID, id),
				Source:        "imported",
				StorageStatus: "ready",
				CreatedAt:     domain.TimeFromString(file.UpdatedAt),
				UpdatedAt:     domain.TimeFromString(file.UpdatedAt),
			},
		}); err != nil {
			return err
		}
		nextSortOrder++
	}
	return nil
}

func scanProjectWorkAssetFiles(root string) ([]localWorkAssetFile, error) {
	files := []localWorkAssetFile{}
	seen := map[string]bool{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("walking project work directory: %w", err)
		}
		if path != root && shouldIgnoreProjectWorkEntry(entry.Name()) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if strings.ToLower(filepath.Ext(entry.Name())) == ".md" {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return fmt.Errorf("relativizing project work asset: %w", err)
		}
		relative = filepath.ToSlash(shared.CleanRelativeFilename(relative))
		key := strings.ToLower(relative)
		if seen[key] {
			return nil
		}
		seen[key] = true

		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("reading project work asset info %s: %w", relative, err)
		}
		mimeType := detectProjectWorkAssetMIME(path)
		dir := filepath.ToSlash(filepath.Dir(relative))
		if dir == "." {
			dir = ""
		}
		files = append(files, localWorkAssetFile{
			RelativePath: relative,
			Dir:          dir,
			Path:         filepath.Clean(path),
			Filename:     filepath.Base(relative),
			Kind:         shared.KindFromMIMEType(mimeType),
			MIMEType:     mimeType,
			SizeBytes:    info.Size(),
			UpdatedAt:    projectWorkFileModTimeRFC3339(info.ModTime()),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(files, func(i, j int) bool {
		return strings.Compare(files[i].RelativePath, files[j].RelativePath) < 0
	})
	return files, nil
}

func (store *ProjectAssets) syncProjectWorkAssetFolders(projectID string, files []localWorkAssetFile) (map[string]string, error) {
	folderIDByPath, err := store.projectWorkFolderIDByPath(projectID)
	if err != nil {
		return nil, err
	}
	usedIDs := map[string]bool{}
	for _, id := range folderIDByPath {
		usedIDs[id] = true
	}
	for _, file := range files {
		if file.Dir == "" {
			continue
		}
		currentPath := ""
		for _, segment := range strings.Split(file.Dir, "/") {
			segment = strings.TrimSpace(segment)
			if segment == "" {
				continue
			}
			if currentPath == "" {
				currentPath = segment
			} else {
				currentPath = filepath.ToSlash(filepath.Join(currentPath, segment))
			}
			key := strings.ToLower(currentPath)
			if _, ok := folderIDByPath[key]; ok {
				continue
			}
			folderID := uniqueProjectWorkFileID("folder-file-", projectID, currentPath, usedIDs)
			folderIDByPath[key] = folderID
		}
	}
	return folderIDByPath, nil
}

func (store *ProjectAssets) projectWorkFolderIDByPath(projectID string) (map[string]string, error) {
	pathByID, err := store.projectWorkFolderPathByID(projectID)
	if err != nil {
		return nil, err
	}
	idByPath := map[string]string{"": ""}
	for id, path := range pathByID {
		idByPath[strings.ToLower(filepath.ToSlash(path))] = id
	}
	return idByPath, nil
}

func (store *ProjectAssets) projectWorkFolderPathByID(projectID string) (map[string]string, error) {
	root := store.projectAssetDir(projectID)
	paths := map[string]string{"": ""}
	if root == "" {
		return paths, nil
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("creating project work directory: %w", err)
	}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("walking project work folders: %w", err)
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && shouldIgnoreProjectWorkEntry(entry.Name()) {
			return filepath.SkipDir
		}
		if path == root {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return fmt.Errorf("relativizing project work folder: %w", err)
		}
		relative = normalizeProjectWorkFolderPath(relative)
		if relative == "" {
			return nil
		}
		id := deterministicProjectWorkFileID("folder-file-", projectID, relative)
		paths[id] = relative
		return nil
	})
	if err != nil {
		return nil, err
	}
	return paths, nil
}

func normalizeProjectWorkFolderPath(path string) string {
	path = filepath.ToSlash(shared.CleanRelativeFilename(path))
	path = strings.Trim(path, "/")
	if path == "." {
		return ""
	}
	return path
}

func projectAssetFolderPathByID(folders []string, projectID string) map[string]string {
	paths := map[string]string{}
	for _, path := range folders {
		path = normalizeProjectWorkFolderPath(path)
		if path == "" {
			continue
		}
		current := ""
		for _, segment := range strings.Split(path, "/") {
			segment = strings.TrimSpace(segment)
			if segment == "" {
				continue
			}
			if current == "" {
				current = segment
			} else {
				current = filepath.ToSlash(filepath.Join(current, segment))
			}
			paths[deterministicProjectWorkFileID("folder-file-", projectID, current)] = current
		}
	}
	return paths
}

func detectProjectWorkAssetMIME(path string) string {
	if mimeType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path))); strings.TrimSpace(mimeType) != "" {
		return shared.NormalizeMIMEType(mimeType)
	}
	file, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer file.Close()

	buffer := make([]byte, 512)
	n, err := file.Read(buffer)
	if err != nil && n == 0 {
		return "application/octet-stream"
	}
	return shared.NormalizeMIMEType(http.DetectContentType(buffer[:n]))
}

func shouldIgnoreProjectWorkEntry(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || strings.HasPrefix(name, ".") {
		return true
	}
	lower := strings.ToLower(name)
	if lower == ".ds_store" || lower == "thumbs.db" {
		return true
	}
	if strings.HasSuffix(lower, "~") ||
		strings.HasSuffix(lower, ".tmp") ||
		strings.HasSuffix(lower, ".temp") ||
		strings.HasSuffix(lower, ".swp") ||
		strings.HasSuffix(lower, ".part") {
		return true
	}
	return false
}

func projectWorkFileModTimeRFC3339(value time.Time) string {
	if value.IsZero() {
		return timestamp.NowRFC3339Nano()
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func uniqueProjectWorkFileID(prefix string, projectID string, seed string, used map[string]bool) string {
	base := deterministicProjectWorkFileID(prefix, projectID, seed)
	id := base
	for suffix := 2; used[id]; suffix++ {
		id = fmt.Sprintf("%s-%d", base, suffix)
	}
	used[id] = true
	return id
}

func deterministicProjectWorkFileID(prefix string, projectID string, seed string) string {
	hash := sha1.Sum([]byte(projectID + "\x00" + filepath.ToSlash(seed)))
	return prefix + hex.EncodeToString(hash[:])[:16]
}
