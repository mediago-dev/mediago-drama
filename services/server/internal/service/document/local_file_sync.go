package document

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"gopkg.in/yaml.v3"
)

type localMarkdownFile struct {
	RelativePath string
	Dir          string
	Title        string
	Content      string
	UpdatedAt    string
}

type localMarkdownTree struct {
	Files       []localMarkdownFile
	FolderPaths []string
}

// WorkspaceSyncDelta reports which documents a local file sync changed so that
// subscribers can refresh incrementally instead of reloading the whole project.
//
// FullReload signals that an incremental delta could not be determined (for
// example the first sync after startup) and consumers should reload everything.
type WorkspaceSyncDelta struct {
	FullReload         bool
	ChangedDocumentIDs []string
	RemovedDocumentIDs []string
	StructureChanged   bool
}

// SyncLocalMarkdownFiles imports local work directory changes into the store and
// returns the set of documents that changed relative to the previous sync.
func (store *Service) SyncLocalMarkdownFiles(projectID string) (WorkspaceSyncDelta, error) {
	if store.initErr != nil {
		return WorkspaceSyncDelta{}, store.initErr
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	previousHashes, previousFolderSignature, hasPrevious := store.currentSyncSnapshotUnlocked(projectID)

	if _, _, err := store.loadLocalMarkdownWorkspaceUnlocked(projectID); err != nil {
		return WorkspaceSyncDelta{}, err
	}
	store.recordDocumentHistory(projectID)

	state, err := store.loadUnlocked(projectID)
	if err != nil {
		return WorkspaceSyncDelta{}, err
	}
	if _, err := store.reconcileProjectSectionsUnlocked(projectID, state); err != nil {
		return WorkspaceSyncDelta{}, err
	}

	// Reconciliation may rewrite files (for example injecting section ids), so the
	// delta must be computed from the post-reconcile content that consumers will
	// actually load — otherwise the next sync would falsely report those files as
	// changed. Cached reads keep this final scan cheap.
	documents, folders, err := store.loadLocalMarkdownWorkspaceUnlocked(projectID)
	if err != nil {
		return WorkspaceSyncDelta{}, err
	}
	delta := store.computeSyncDeltaUnlocked(projectID, documents, folders, previousHashes, previousFolderSignature, hasPrevious)
	return delta, nil
}

// computeSyncDeltaUnlocked diffs the freshly scanned documents and folders
// against the previously observed snapshot for the project. The store mutex must
// be held by the caller; the snapshot maps are only ever touched here.
func (store *Service) computeSyncDeltaUnlocked(
	projectID string,
	documents []mediamcp.WorkspaceDocument,
	folders []mediamcp.DocumentFolder,
	previousHashes map[string]string,
	previousFolderSignature string,
	hasPrevious bool,
) WorkspaceSyncDelta {
	projectID = domain.CleanProjectID(projectID)
	newHashes := make(map[string]string, len(documents))
	for _, document := range documents {
		newHashes[document.ID] = documentSyncFingerprint(document)
	}
	folderSignature := folderStructureSignature(folders)

	delta := WorkspaceSyncDelta{}
	if !hasPrevious {
		// First observation for this project: we cannot tell what changed, so ask
		// consumers to reload fully once and rely on incremental deltas afterwards.
		delta.FullReload = true
	} else {
		for id, hash := range newHashes {
			if previousHashes[id] != hash {
				delta.ChangedDocumentIDs = append(delta.ChangedDocumentIDs, id)
			}
		}
		for id := range previousHashes {
			if _, ok := newHashes[id]; !ok {
				delta.RemovedDocumentIDs = append(delta.RemovedDocumentIDs, id)
			}
		}
		// StructureChanged tracks the folder tree only. Document additions and
		// removals are reported via Changed/RemovedDocumentIDs, so consumers do not
		// need to refetch folders just because a document came or went.
		delta.StructureChanged = folderSignature != previousFolderSignature
		sort.Strings(delta.ChangedDocumentIDs)
		sort.Strings(delta.RemovedDocumentIDs)
	}

	store.rememberSyncSnapshotUnlocked(projectID, documents, folders)
	return delta
}

func (store *Service) currentSyncSnapshotUnlocked(projectID string) (map[string]string, string, bool) {
	projectID = domain.CleanProjectID(projectID)
	previousHashes, hasPrevious := store.docHashes[projectID]
	hashes := make(map[string]string, len(previousHashes))
	for id, hash := range previousHashes {
		hashes[id] = hash
	}
	return hashes, store.folderSignatures[projectID], hasPrevious
}

func (store *Service) rememberSyncSnapshotUnlocked(
	projectID string,
	documents []mediamcp.WorkspaceDocument,
	folders []mediamcp.DocumentFolder,
) {
	projectID = domain.CleanProjectID(projectID)
	hashes := make(map[string]string, len(documents))
	for _, document := range documents {
		hashes[document.ID] = documentSyncFingerprint(document)
	}
	store.docHashes[projectID] = hashes
	store.folderSignatures[projectID] = folderStructureSignature(folders)
}

// documentSyncFingerprint hashes the fields that affect how a document renders so
// that any meaningful change (body or metadata) produces a different value.
func documentSyncFingerprint(document mediamcp.WorkspaceDocument) string {
	hasher := sha1.New()
	_, _ = fmt.Fprintf(
		hasher,
		"%s\x00%s\x00%s\x00%s\x00%s\x00%d\x00%s\x00%s",
		document.ID,
		document.Title,
		document.Category,
		document.ParentID,
		document.FolderID,
		document.SortOrder,
		strings.Join(document.Tags, ","),
		document.Content,
	)
	return hex.EncodeToString(hasher.Sum(nil))
}

// folderStructureSignature hashes the folder tree so folder additions, renames
// and moves can be detected without comparing documents.
func folderStructureSignature(folders []mediamcp.DocumentFolder) string {
	if len(folders) == 0 {
		return ""
	}
	ordered := make([]mediamcp.DocumentFolder, len(folders))
	copy(ordered, folders)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	hasher := sha1.New()
	for _, folder := range ordered {
		_, _ = fmt.Fprintf(
			hasher,
			"%s\x00%s\x00%s\x00%d\n",
			folder.ID,
			folder.Name,
			folder.ParentID,
			folder.SortOrder,
		)
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func (store *Service) loadLocalMarkdownWorkspaceUnlocked(projectID string) ([]mediamcp.WorkspaceDocument, []mediamcp.DocumentFolder, error) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return []mediamcp.WorkspaceDocument{}, []mediamcp.DocumentFolder{}, nil
	}
	if err := store.ensureProjectRecordUnlocked(projectID); err != nil {
		return nil, nil, err
	}
	docsDir := store.documentsDir(projectID)
	if docsDir == "" {
		return []mediamcp.WorkspaceDocument{}, []mediamcp.DocumentFolder{}, nil
	}
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		return nil, nil, fmt.Errorf("creating work directory: %w", err)
	}
	assetDocumentPaths, err := store.projectAssetDocumentRelativePaths(projectID, docsDir)
	if err != nil {
		return nil, nil, err
	}
	tree, err := scanLocalMarkdownTree(docsDir, store.fileCache, assetDocumentPaths)
	if err != nil {
		return nil, nil, err
	}
	folderIDByDir, folders := localMarkdownFolderRecords(projectID, tree.FolderPaths, nil)
	documents := make([]mediamcp.WorkspaceDocument, 0, len(tree.Files))
	sortOrderByFolder := map[string]int{}
	usedDocumentIDs := map[string]bool{}
	for _, file := range tree.Files {
		folderID := folderIDByDir[strings.ToLower(filepath.ToSlash(file.Dir))]
		sortOrder := sortOrderByFolder[folderID]
		sortOrderByFolder[folderID] = sortOrder + 1
		content := stripLocalMarkdownFrontmatter(file.Content)
		metadata := localMarkdownMetadata(file.Content)
		title := localMarkdownDocumentTitle(metadata, file.Title)
		documentID := localMarkdownDocumentID(projectID, file.RelativePath, metadata.ID, usedDocumentIDs)
		version := NormalizedDocumentVersion(metadata.Version)
		documents = append(documents, mediamcp.WorkspaceDocument{
			ID:             documentID,
			Title:          title,
			Filename:       file.RelativePath,
			Content:        content,
			Category:       localMarkdownDocumentCategory(metadata.Category, title, file.RelativePath),
			ParentID:       metadata.ParentID,
			FolderID:       folderID,
			SortOrder:      sortOrder,
			UpdatedAt:      file.UpdatedAt,
			IsDirty:        false,
			Version:        version,
			Tags:           metadata.Tags,
			Comments:       NormalizeCommentRecordsForDocument(documentID, content, metadata.Comments),
			WorkbenchDraft: metadata.WorkbenchDraft,
		})
	}
	return NormalizeWorkspaceDocuments(documents), folders, nil
}

func scanLocalMarkdownTree(root string, cache *markdownFileCache, excludedFiles map[string]bool) (localMarkdownTree, error) {
	files := []localMarkdownFile{}
	folderPaths := []string{}
	seenFiles := map[string]bool{}
	seenFolders := map[string]bool{}
	cacheEntries := map[string]cachedMarkdownFile{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("walking work directory: %w", err)
		}
		if path != root && shouldIgnoreWorkEntry(entry.Name()) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if path == root {
				return nil
			}
			relative, err := filepath.Rel(root, path)
			if err != nil {
				return fmt.Errorf("relativizing markdown folder: %w", err)
			}
			relative = normalizeLocalMarkdownPath(relative)
			if relative == "" {
				return nil
			}
			key := strings.ToLower(relative)
			if !seenFolders[key] {
				seenFolders[key] = true
				folderPaths = append(folderPaths, relative)
			}
			return nil
		}
		if !isLocalDocumentFile(entry.Name()) {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return fmt.Errorf("relativizing markdown file: %w", err)
		}
		relative = normalizeLocalMarkdownPath(relative)
		relativeKey := strings.ToLower(relative)
		if excludedFiles[relativeKey] {
			return nil
		}
		if seenFiles[relativeKey] {
			return nil
		}
		seenFiles[relativeKey] = true

		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("reading markdown file info %s: %w", relative, err)
		}
		size := info.Size()
		modTime := info.ModTime().UnixNano()
		content, cached := cache.get(root, relative, size, modTime)
		if !cached {
			data, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("reading markdown file %s: %w", relative, err)
			}
			content = string(data)
		}
		cacheEntries[relative] = cachedMarkdownFile{size: size, modTime: modTime, content: content}
		updatedAt := fileModTimeRFC3339(info.ModTime())
		dir := filepath.ToSlash(filepath.Dir(relative))
		if dir == "." {
			dir = ""
		}
		files = append(files, localMarkdownFile{
			RelativePath: relative,
			Dir:          dir,
			Title:        localMarkdownTitle(relative),
			Content:      content,
			UpdatedAt:    updatedAt,
		})
		return nil
	})
	if err != nil {
		return localMarkdownTree{}, err
	}
	cache.replace(root, cacheEntries)
	sort.SliceStable(files, func(i, j int) bool {
		return strings.Compare(files[i].RelativePath, files[j].RelativePath) < 0
	})
	folderPaths = expandedLocalMarkdownFolderPaths(folderPaths)
	return localMarkdownTree{Files: files, FolderPaths: folderPaths}, nil
}

func (store *Service) projectAssetDocumentRelativePaths(projectID string, docsDir string) (map[string]bool, error) {
	if store.assets == nil {
		return nil, nil
	}
	projectDir := store.projectDir(projectID)
	if projectDir == "" {
		return nil, nil
	}
	models, err := store.assets.ListProjectAssets(projectID)
	if err != nil {
		return nil, fmt.Errorf("listing project assets for document scan: %w", err)
	}
	excluded := map[string]bool{}
	for _, model := range models {
		if isMarkdownProjectAsset(model.Asset.Filename, model.Asset.MIMEType) {
			continue
		}
		relPath := strings.TrimSpace(model.Asset.RelPath)
		if relPath == "" {
			continue
		}
		path := relPath
		if !filepath.IsAbs(path) {
			path = filepath.Join(projectDir, filepath.FromSlash(path))
		}
		relative, err := filepath.Rel(docsDir, path)
		if err != nil || relative == "." || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			continue
		}
		relative = normalizeLocalMarkdownPath(relative)
		if relative == "" || !isLocalDocumentFile(relative) {
			continue
		}
		excluded[strings.ToLower(relative)] = true
	}
	return excluded, nil
}

func isMarkdownProjectAsset(filename string, mimeType string) bool {
	filename = strings.ToLower(strings.TrimSpace(filename))
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	return strings.HasSuffix(filename, ".md") ||
		strings.HasSuffix(filename, ".markdown") ||
		mimeType == "text/markdown" ||
		mimeType == "text/x-markdown"
}

type documentMarkdownFrontmatter struct {
	ID             string                           `yaml:"id,omitempty"`
	Title          string                           `yaml:"title,omitempty"`
	Category       string                           `yaml:"category,omitempty"`
	Version        int                              `yaml:"version,omitempty"`
	ParentID       string                           `yaml:"parentId,omitempty"`
	Tags           []string                         `yaml:"tags,omitempty"`
	Comments       []mediamcp.DocumentComment       `yaml:"comments,omitempty"`
	WorkbenchDraft *mediamcp.DocumentWorkbenchDraft `yaml:"workbenchDraft,omitempty"`
}

func localMarkdownMetadata(content string) documentMarkdownFrontmatter {
	frontmatter, _, ok := splitLocalMarkdownFrontmatter(content)
	if !ok {
		return documentMarkdownFrontmatter{}
	}
	var metadata documentMarkdownFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatter), &metadata); err != nil {
		return documentMarkdownFrontmatter{}
	}
	metadata.Category = NormalizeDocumentCategoryValue(metadata.Category)
	if ValidateDocumentCategory(metadata.Category) != nil {
		metadata.Category = ""
	}
	metadata.ID = strings.TrimSpace(metadata.ID)
	metadata.Title = strings.TrimSpace(metadata.Title)
	metadata.ParentID = strings.TrimSpace(metadata.ParentID)
	metadata.Tags = NormalizeDocumentTags(metadata.Tags)
	return metadata
}

func stripLocalMarkdownFrontmatter(content string) string {
	_, body, ok := splitLocalMarkdownFrontmatter(content)
	if !ok {
		return content
	}
	return body
}

func localMarkdownDocumentCategory(category string, title string, relativePath string) string {
	category = NormalizeDocumentCategoryValue(category)
	inferred := inferBusinessDocumentCategoryFromHints(title, relativePath)
	if inferred != "" && !hasReferenceDocumentHint(title, relativePath) {
		if category == "" || category == referenceDocumentCategory {
			return inferred
		}
	}
	if category != "" {
		return category
	}
	return referenceDocumentCategory
}

func localMarkdownDocumentTitle(metadata documentMarkdownFrontmatter, fallback string) string {
	if title := strings.TrimSpace(metadata.Title); title != "" {
		return title
	}
	return fallback
}

func localMarkdownDocumentID(
	projectID string,
	relativePath string,
	metadataID string,
	used map[string]bool,
) string {
	id := strings.TrimSpace(metadataID)
	if id != "" && !used[id] {
		used[id] = true
		return id
	}
	return uniqueLocalFileID("doc-file-", projectID, relativePath, used)
}

func localMarkdownProjectionContent(document mediamcp.WorkspaceDocument, filename string) string {
	if !isMarkdownDocumentFilename(filename) {
		return stripLocalMarkdownFrontmatter(document.Content)
	}
	category := NormalizeDocumentCategoryValue(document.Category)
	if category == "" || ValidateDocumentCategory(category) != nil {
		category = referenceDocumentCategory
	}
	frontmatter, err := yaml.Marshal(documentMarkdownFrontmatter{
		ID:             strings.TrimSpace(document.ID),
		Title:          strings.TrimSpace(document.Title),
		Category:       category,
		Version:        NormalizedDocumentVersion(document.Version),
		ParentID:       strings.TrimSpace(document.ParentID),
		Tags:           NormalizeDocumentTags(document.Tags),
		Comments:       NormalizeCommentRecordsForDocument(document.ID, document.Content, document.Comments),
		WorkbenchDraft: document.WorkbenchDraft,
	})
	if err != nil {
		return stripLocalMarkdownFrontmatter(document.Content)
	}
	return fmt.Sprintf("---\n%s---\n%s", string(frontmatter), stripLocalMarkdownFrontmatter(document.Content))
}

func isMarkdownDocumentFilename(filename string) bool {
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(filename))) {
	case ".md", ".markdown":
		return true
	default:
		return false
	}
}

func splitLocalMarkdownFrontmatter(content string) (string, string, bool) {
	content = strings.TrimPrefix(strings.ReplaceAll(content, "\r\n", "\n"), "\ufeff")
	if !strings.HasPrefix(content, "---\n") {
		return "", content, false
	}
	rest := strings.TrimPrefix(content, "---\n")
	end := strings.Index(rest, "\n---\n")
	if end < 0 {
		if !strings.HasSuffix(rest, "\n---") {
			return "", content, false
		}
		end = len(rest) - len("\n---")
		return rest[:end], "", true
	}
	frontmatter := rest[:end]
	body := rest[end+len("\n---\n"):]
	return frontmatter, body, true
}

func localMarkdownFolderRecords(
	projectID string,
	folderPaths []string,
	folders []mediamcp.DocumentFolder,
) (map[string]string, []mediamcp.DocumentFolder) {
	now := timestamp.NowRFC3339Nano()
	normalized := NormalizeDocumentFolders(folders)
	pathByID := DocumentFolderPathByID(normalized)
	folderIDByPath := map[string]string{"": ""}
	existingByPath := map[string]mediamcp.DocumentFolder{}
	usedIDs := map[string]bool{}
	sortOrderByParent := map[string]int{}
	for _, folder := range normalized {
		usedIDs[folder.ID] = true
		if folder.SortOrder >= sortOrderByParent[folder.ParentID] {
			sortOrderByParent[folder.ParentID] = folder.SortOrder + 1
		}
		if path := pathByID[folder.ID]; path != "" {
			key := strings.ToLower(filepath.ToSlash(path))
			folderIDByPath[key] = folder.ID
			existingByPath[key] = folder
		}
	}

	desiredFolders := []mediamcp.DocumentFolder{}
	for _, folderPath := range expandedLocalMarkdownFolderPaths(folderPaths) {
		currentPath := ""
		for _, segment := range strings.Split(folderPath, "/") {
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

			folderID := uniqueLocalFileID("folder-file-", projectID, currentPath, usedIDs)
			folderIDByPath[key] = folderID
		}
	}

	for _, folderPath := range expandedLocalMarkdownFolderPaths(folderPaths) {
		parentPath := filepath.ToSlash(filepath.Dir(folderPath))
		if parentPath == "." {
			parentPath = ""
		}
		parentID := folderIDByPath[strings.ToLower(parentPath)]
		name := filepath.Base(folderPath)
		key := strings.ToLower(folderPath)
		if existing, ok := existingByPath[key]; ok {
			existing.ParentID = parentID
			folderIDByPath[key] = existing.ID
			desiredFolders = append(desiredFolders, existing)
			continue
		}

		folderID := folderIDByPath[key]
		if folderID == "" {
			folderID = uniqueLocalFileID("folder-file-", projectID, folderPath, usedIDs)
			folderIDByPath[key] = folderID
		}
		folder := mediamcp.DocumentFolder{
			ID:        folderID,
			Name:      name,
			ParentID:  parentID,
			SortOrder: sortOrderByParent[parentID],
			CreatedAt: now,
			UpdatedAt: now,
		}
		sortOrderByParent[parentID]++
		desiredFolders = append(desiredFolders, folder)
	}
	return folderIDByPath, NormalizeDocumentFolders(desiredFolders)
}

func normalizeLocalMarkdownPath(path string) string {
	path = filepath.ToSlash(CleanRelativeFilename(path))
	path = strings.Trim(path, "/")
	if path == "." {
		return ""
	}
	return path
}

func expandedLocalMarkdownFolderPaths(paths []string) []string {
	seen := map[string]bool{}
	expanded := []string{}
	for _, path := range paths {
		path = normalizeLocalMarkdownPath(path)
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
			key := strings.ToLower(current)
			if seen[key] {
				continue
			}
			seen[key] = true
			expanded = append(expanded, current)
		}
	}
	sort.SliceStable(expanded, func(i, j int) bool {
		leftDepth := strings.Count(expanded[i], "/")
		rightDepth := strings.Count(expanded[j], "/")
		if leftDepth != rightDepth {
			return leftDepth < rightDepth
		}
		return strings.Compare(expanded[i], expanded[j]) < 0
	})
	return expanded
}

func localMarkdownTitle(relative string) string {
	base := filepath.Base(filepath.ToSlash(relative))
	title := strings.TrimSuffix(base, filepath.Ext(base))
	title = strings.TrimSpace(title)
	if title == "" {
		return "未命名文档"
	}
	return title
}

func shouldIgnoreWorkEntry(name string) bool {
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

func isLocalDocumentFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".txt":
		return true
	default:
		return false
	}
}

func fileModTimeRFC3339(value time.Time) string {
	if value.IsZero() {
		return timestamp.NowRFC3339Nano()
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func uniqueLocalFileID(prefix string, projectID string, seed string, used map[string]bool) string {
	base := deterministicLocalFileID(prefix, projectID, seed)
	id := base
	for suffix := 2; used[id]; suffix++ {
		id = fmt.Sprintf("%s-%d", base, suffix)
	}
	used[id] = true
	return id
}

func deterministicLocalFileID(prefix string, projectID string, seed string) string {
	hash := sha1.Sum([]byte(projectID + "\x00" + filepath.ToSlash(seed)))
	return prefix + hex.EncodeToString(hash[:])[:16]
}
