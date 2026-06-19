package documenthistory

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-billy/v5/osfs"
	git "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/cache"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/storage/filesystem"
	"gopkg.in/yaml.v3"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const (
	historyRepoDirName      = "document-history.git"
	defaultCommitSummary    = "docs: update workspace documents"
	defaultCommitSource     = "system"
	defaultCommitOperation  = "workspace_save"
	historyCommitAuthorName = "MediaGo Drama"
	historyCommitEmail      = "history@mediago.local"
)

// Service records project document snapshots in an app-owned Git repository.
type Service struct {
	mu sync.Mutex
}

// CommitRequest describes one document snapshot commit.
type CommitRequest struct {
	ProjectID  string
	ProjectDir string
	WorkDir    string
	Summary    string
	Source     string
	Operation  string
	When       time.Time
}

// HistoryItem is a lightweight projection of a document-history commit.
type HistoryItem struct {
	Hash        string    `json:"hash"`
	Summary     string    `json:"summary"`
	Message     string    `json:"message"`
	ProjectID   string    `json:"projectId,omitempty"`
	Source      string    `json:"source,omitempty"`
	Operation   string    `json:"operation,omitempty"`
	DocumentIDs []string  `json:"documentIds"`
	Paths       []string  `json:"paths"`
	CreatedAt   time.Time `json:"createdAt"`
}

// DocumentVersion is the content of one document at a specific history commit.
type DocumentVersion struct {
	Hash       string    `json:"hash"`
	ParentHash string    `json:"parentHash,omitempty"`
	DocumentID string    `json:"documentId"`
	Title      string    `json:"title"`
	Category   string    `json:"category,omitempty"`
	Tags       []string  `json:"tags,omitempty"`
	Content    string    `json:"content"`
	Path       string    `json:"path"`
	CreatedAt  time.Time `json:"createdAt"`
}

// DiffLine describes one line in a document history diff.
type DiffLine struct {
	Type    string `json:"type"`
	OldLine int    `json:"oldLine,omitempty"`
	NewLine int    `json:"newLine,omitempty"`
	Text    string `json:"text"`
}

// DocumentDiff is a line-oriented comparison between two document versions.
type DocumentDiff struct {
	DocumentID string           `json:"documentId"`
	From       *DocumentVersion `json:"from,omitempty"`
	To         DocumentVersion  `json:"to"`
	Lines      []DiffLine       `json:"lines"`
}

type changedDocument struct {
	ID    string
	Title string
	Path  string
}

type markdownFrontmatter struct {
	ID       string   `yaml:"id,omitempty"`
	Title    string   `yaml:"title,omitempty"`
	Category string   `yaml:"category,omitempty"`
	Tags     []string `yaml:"tags,omitempty"`
}

// NewService returns a document history service.
func NewService() *Service {
	return &Service{}
}

// CommitProjectDocuments records the current work directory if tracked document files changed.
func (service *Service) CommitProjectDocuments(request CommitRequest) (string, error) {
	if service == nil {
		return "", fmt.Errorf("document history service is not configured")
	}
	service.mu.Lock()
	defer service.mu.Unlock()

	repo, err := openOrInitRepository(request.ProjectDir, request.WorkDir)
	if err != nil {
		return "", err
	}
	worktree, err := repo.Worktree()
	if err != nil {
		return "", fmt.Errorf("opening document history worktree: %w", err)
	}
	status, err := worktree.Status()
	if err != nil {
		return "", fmt.Errorf("reading document history status: %w", err)
	}
	if status.IsClean() {
		return "", nil
	}

	changed, paths := changedMarkdownDocuments(repo, request.WorkDir, status)
	if len(paths) == 0 {
		return "", nil
	}
	for _, path := range paths {
		if _, err := worktree.Add(path); err != nil {
			return "", fmt.Errorf("staging document history changes for %s: %w", path, err)
		}
	}

	when := request.When
	if when.IsZero() {
		when = time.Now()
	}
	signature := &object.Signature{
		Name:  historyCommitAuthorName,
		Email: historyCommitEmail,
		When:  when,
	}
	hash, err := worktree.Commit(commitMessage(request, changed, paths), &git.CommitOptions{
		Author:    signature,
		Committer: signature,
	})
	if errors.Is(err, git.ErrEmptyCommit) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("committing document history: %w", err)
	}
	return hash.String(), nil
}

// ListProjectHistory returns recent project document-history commits.
func (service *Service) ListProjectHistory(projectDir string, workDir string, limit int) ([]HistoryItem, error) {
	if service == nil {
		return nil, fmt.Errorf("document history service is not configured")
	}
	service.mu.Lock()
	defer service.mu.Unlock()

	repo, err := openOrInitRepository(projectDir, workDir)
	if err != nil {
		return nil, err
	}
	iter, err := repo.Log(&git.LogOptions{Order: git.LogOrderCommitterTime})
	if errors.Is(err, plumbing.ErrReferenceNotFound) {
		return []HistoryItem{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading document history log: %w", err)
	}
	defer iter.Close()

	items := []HistoryItem{}
	err = iter.ForEach(func(commit *object.Commit) error {
		if limit > 0 && len(items) >= limit {
			return errStopIteration
		}
		items = append(items, historyItemFromCommit(commit))
		return nil
	})
	if errors.Is(err, errStopIteration) {
		err = nil
	}
	return items, err
}

// ListDocumentHistory returns recent commits tagged with a document ID.
func (service *Service) ListDocumentHistory(projectDir string, workDir string, documentID string, limit int) ([]HistoryItem, error) {
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return []HistoryItem{}, nil
	}
	items, err := service.ListProjectHistory(projectDir, workDir, 0)
	if err != nil {
		return nil, err
	}
	matches := []HistoryItem{}
	for _, item := range items {
		if !containsString(item.DocumentIDs, documentID) {
			continue
		}
		matches = append(matches, item)
		if limit > 0 && len(matches) >= limit {
			break
		}
	}
	return matches, nil
}

// GetDocumentVersion returns one document version from a history commit.
func (service *Service) GetDocumentVersion(projectDir string, workDir string, documentID string, commitHash string) (DocumentVersion, bool, error) {
	if service == nil {
		return DocumentVersion{}, false, fmt.Errorf("document history service is not configured")
	}
	service.mu.Lock()
	defer service.mu.Unlock()

	repo, err := openOrInitRepository(projectDir, workDir)
	if err != nil {
		return DocumentVersion{}, false, err
	}
	commit, err := commitByHash(repo, commitHash)
	if errors.Is(err, plumbing.ErrObjectNotFound) {
		return DocumentVersion{}, false, nil
	}
	if err != nil {
		return DocumentVersion{}, false, err
	}
	return documentVersionFromCommit(repo, commit, documentID)
}

// DiffDocumentVersion returns a line diff from the parent or supplied base commit to the requested commit.
func (service *Service) DiffDocumentVersion(projectDir string, workDir string, documentID string, commitHash string, fromHash string) (DocumentDiff, bool, error) {
	if service == nil {
		return DocumentDiff{}, false, fmt.Errorf("document history service is not configured")
	}
	service.mu.Lock()
	defer service.mu.Unlock()

	repo, err := openOrInitRepository(projectDir, workDir)
	if err != nil {
		return DocumentDiff{}, false, err
	}
	toCommit, err := commitByHash(repo, commitHash)
	if errors.Is(err, plumbing.ErrObjectNotFound) {
		return DocumentDiff{}, false, nil
	}
	if err != nil {
		return DocumentDiff{}, false, err
	}
	to, ok, err := documentVersionFromCommit(repo, toCommit, documentID)
	if err != nil || !ok {
		return DocumentDiff{}, ok, err
	}

	var from *DocumentVersion
	if strings.TrimSpace(fromHash) != "" {
		fromCommit, err := commitByHash(repo, fromHash)
		if errors.Is(err, plumbing.ErrObjectNotFound) {
			return DocumentDiff{}, false, nil
		}
		if err != nil {
			return DocumentDiff{}, false, err
		}
		version, ok, err := documentVersionFromCommit(repo, fromCommit, documentID)
		if err != nil || !ok {
			return DocumentDiff{}, ok, err
		}
		from = &version
	} else {
		from, err = parentDocumentVersion(repo, toCommit, documentID)
		if err != nil {
			return DocumentDiff{}, false, err
		}
	}

	fromContent := ""
	if from != nil {
		fromContent = from.Content
	}
	return DocumentDiff{
		DocumentID: documentID,
		From:       from,
		To:         to,
		Lines:      diffContentLines(fromContent, to.Content),
	}, true, nil
}

func openOrInitRepository(projectDir string, workDir string) (*git.Repository, error) {
	projectDir = shared.ResolveWorkspaceDir(projectDir)
	workDir = shared.ResolveWorkspaceDir(workDir)
	if projectDir == "" {
		return nil, fmt.Errorf("projectDir is required")
	}
	if workDir == "" {
		return nil, fmt.Errorf("workDir is required")
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating document history work directory: %w", err)
	}
	gitDir := HistoryRepositoryDir(projectDir)
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating document history repository: %w", err)
	}

	storage := filesystem.NewStorage(osfs.New(gitDir), cache.NewObjectLRUDefault())
	worktree := osfs.New(workDir)
	repo, err := git.Open(storage, worktree)
	if errors.Is(err, git.ErrRepositoryNotExists) {
		repo, err = git.Init(storage, worktree)
	}
	if err != nil {
		return nil, fmt.Errorf("opening document history repository: %w", err)
	}
	if err := removeHistoryDotGitFile(workDir, gitDir); err != nil {
		return nil, err
	}
	return repo, nil
}

// HistoryRepositoryDir returns the app-owned Git storage path for a project.
func HistoryRepositoryDir(projectDir string) string {
	return filepath.Join(shared.ProjectMetadataDir(projectDir), historyRepoDirName)
}

func removeHistoryDotGitFile(workDir string, gitDir string) error {
	dotGitPath := filepath.Join(workDir, git.GitDirName)
	info, err := os.Lstat(dotGitPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("checking document history .git file: %w", err)
	}
	if info.IsDir() {
		return nil
	}
	content, err := os.ReadFile(dotGitPath)
	if err != nil {
		return fmt.Errorf("reading document history .git file: %w", err)
	}
	target, ok := strings.CutPrefix(strings.TrimSpace(string(content)), "gitdir:")
	if !ok {
		return nil
	}
	target = strings.TrimSpace(target)
	if target == "" {
		return nil
	}
	targetPath := target
	if !filepath.IsAbs(targetPath) {
		targetPath = filepath.Join(workDir, targetPath)
	}
	targetPath = shared.ResolveWorkspaceDir(targetPath)
	gitDir = shared.ResolveWorkspaceDir(gitDir)
	if targetPath != gitDir {
		return nil
	}
	if err := os.Remove(dotGitPath); err != nil {
		return fmt.Errorf("removing document history .git file: %w", err)
	}
	return nil
}

func changedMarkdownDocuments(repo *git.Repository, workDir string, status git.Status) ([]changedDocument, []string) {
	documentsByID := map[string]changedDocument{}
	paths := []string{}
	for path, fileStatus := range status {
		if !isMarkdownPath(path) {
			continue
		}
		paths = append(paths, filepath.ToSlash(path))
		for _, document := range documentsForChangedPath(repo, workDir, path, fileStatus) {
			if document.ID == "" {
				continue
			}
			if existing, ok := documentsByID[document.ID]; ok {
				existing.Path = firstNonEmpty(existing.Path, document.Path)
				existing.Title = firstNonEmpty(existing.Title, document.Title)
				documentsByID[document.ID] = existing
				continue
			}
			documentsByID[document.ID] = document
		}
	}
	documents := make([]changedDocument, 0, len(documentsByID))
	for _, document := range documentsByID {
		documents = append(documents, document)
	}
	sort.Slice(documents, func(i, j int) bool {
		return documents[i].ID < documents[j].ID
	})
	paths = uniqueSorted(paths)
	return documents, paths
}

func documentsForChangedPath(repo *git.Repository, workDir string, path string, status *git.FileStatus) []changedDocument {
	documents := []changedDocument{}
	if status == nil {
		return documents
	}
	if status.Worktree != git.Deleted {
		if document, ok := documentFromWorktreePath(workDir, path); ok {
			documents = append(documents, document)
		}
	}
	if status.Worktree == git.Deleted || status.Staging == git.Deleted || status.Extra != "" {
		if document, ok := documentFromHeadPath(repo, path); ok {
			documents = append(documents, document)
		}
	}
	return documents
}

func documentFromWorktreePath(workDir string, path string) (changedDocument, bool) {
	content, err := os.ReadFile(filepath.Join(workDir, filepath.FromSlash(path)))
	if err != nil {
		return changedDocument{}, false
	}
	metadata, ok := markdownMetadata(string(content))
	if !ok || metadata.ID == "" {
		return changedDocument{}, false
	}
	return changedDocument{ID: metadata.ID, Title: metadata.Title, Path: filepath.ToSlash(path)}, true
}

func documentFromHeadPath(repo *git.Repository, path string) (changedDocument, bool) {
	ref, err := repo.Head()
	if err != nil {
		return changedDocument{}, false
	}
	commit, err := repo.CommitObject(ref.Hash())
	if err != nil {
		return changedDocument{}, false
	}
	file, err := commit.File(filepath.ToSlash(path))
	if err != nil {
		return changedDocument{}, false
	}
	content, err := file.Contents()
	if err != nil {
		return changedDocument{}, false
	}
	metadata, ok := markdownMetadata(content)
	if !ok || metadata.ID == "" {
		return changedDocument{}, false
	}
	return changedDocument{ID: metadata.ID, Title: metadata.Title, Path: filepath.ToSlash(path)}, true
}

func commitByHash(repo *git.Repository, commitHash string) (*object.Commit, error) {
	commitHash = strings.TrimSpace(commitHash)
	if commitHash == "" {
		return nil, plumbing.ErrObjectNotFound
	}
	commit, err := repo.CommitObject(plumbing.NewHash(commitHash))
	if err != nil {
		return nil, fmt.Errorf("reading document history commit %s: %w", commitHash, err)
	}
	return commit, nil
}

func documentVersionFromCommit(repo *git.Repository, commit *object.Commit, documentID string) (DocumentVersion, bool, error) {
	documentID = strings.TrimSpace(documentID)
	if commit == nil || documentID == "" {
		return DocumentVersion{}, false, nil
	}
	files, err := commit.Files()
	if err != nil {
		return DocumentVersion{}, false, fmt.Errorf("reading document history files: %w", err)
	}
	defer files.Close()

	var version DocumentVersion
	found := false
	err = files.ForEach(func(file *object.File) error {
		if found || file == nil || !isMarkdownPath(file.Name) {
			return nil
		}
		content, err := file.Contents()
		if err != nil {
			return fmt.Errorf("reading document history file %s: %w", file.Name, err)
		}
		metadata, ok := markdownMetadata(content)
		if !ok || metadata.ID != documentID {
			return nil
		}
		version = DocumentVersion{
			Hash:       commit.Hash.String(),
			ParentHash: firstParentHash(commit),
			DocumentID: metadata.ID,
			Title:      metadata.Title,
			Category:   metadata.Category,
			Tags:       metadata.Tags,
			Content:    stripMarkdownFrontmatter(content),
			Path:       filepath.ToSlash(file.Name),
			CreatedAt:  commit.Committer.When,
		}
		found = true
		return nil
	})
	if err != nil {
		return DocumentVersion{}, false, err
	}
	return version, found, nil
}

func parentDocumentVersion(repo *git.Repository, commit *object.Commit, documentID string) (*DocumentVersion, error) {
	if commit == nil || commit.NumParents() == 0 {
		return nil, nil
	}
	parent, err := commit.Parent(0)
	if errors.Is(err, plumbing.ErrObjectNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading parent document history commit: %w", err)
	}
	version, ok, err := documentVersionFromCommit(repo, parent, documentID)
	if err != nil || !ok {
		return nil, err
	}
	return &version, nil
}

func firstParentHash(commit *object.Commit) string {
	if commit == nil || commit.NumParents() == 0 {
		return ""
	}
	parent, err := commit.Parent(0)
	if err != nil || parent == nil {
		return ""
	}
	return parent.Hash.String()
}

func markdownMetadata(content string) (markdownFrontmatter, bool) {
	frontmatter, _, ok := splitMarkdownFrontmatter(content)
	if !ok {
		return markdownFrontmatter{}, false
	}
	var metadata markdownFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatter), &metadata); err != nil {
		return markdownFrontmatter{}, false
	}
	metadata.ID = strings.TrimSpace(metadata.ID)
	metadata.Title = strings.TrimSpace(metadata.Title)
	metadata.Category = strings.TrimSpace(metadata.Category)
	metadata.Tags = normalizeTags(metadata.Tags)
	return metadata, metadata.ID != ""
}

func stripMarkdownFrontmatter(content string) string {
	_, body, ok := splitMarkdownFrontmatter(content)
	if !ok {
		return strings.TrimPrefix(strings.ReplaceAll(content, "\r\n", "\n"), "\ufeff")
	}
	return body
}

func splitMarkdownFrontmatter(content string) (string, string, bool) {
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
	return rest[:end], rest[end+len("\n---\n"):], true
}

func commitMessage(request CommitRequest, documents []changedDocument, paths []string) string {
	summary := strings.TrimSpace(request.Summary)
	if summary == "" {
		summary = defaultSummary(documents)
	}
	source := firstNonEmpty(request.Source, defaultCommitSource)
	operation := firstNonEmpty(request.Operation, defaultCommitOperation)
	lines := []string{summary, ""}
	lines = appendTrailer(lines, "Project-ID", strings.TrimSpace(request.ProjectID))
	lines = appendTrailer(lines, "Source", source)
	lines = appendTrailer(lines, "Operation", operation)
	for _, document := range documents {
		lines = appendTrailer(lines, "Document-ID", document.ID)
		lines = appendTrailer(lines, "Document-Title", document.Title)
	}
	for _, path := range paths {
		lines = appendTrailer(lines, "Path", path)
	}
	return strings.Join(lines, "\n")
}

func defaultSummary(documents []changedDocument) string {
	if len(documents) == 1 {
		label := firstNonEmpty(documents[0].Title, documents[0].Path, documents[0].ID)
		if label != "" {
			return "docs: update " + label
		}
	}
	return defaultCommitSummary
}

func appendTrailer(lines []string, key string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return lines
	}
	return append(lines, fmt.Sprintf("%s: %s", key, value))
}

func historyItemFromCommit(commit *object.Commit) HistoryItem {
	summary, trailers := parseCommitMessage(commit.Message)
	return HistoryItem{
		Hash:        commit.Hash.String(),
		Summary:     summary,
		Message:     commit.Message,
		ProjectID:   firstTrailer(trailers, "project-id"),
		Source:      firstTrailer(trailers, "source"),
		Operation:   firstTrailer(trailers, "operation"),
		DocumentIDs: uniqueSorted(trailers["document-id"]),
		Paths:       uniqueSorted(trailers["path"]),
		CreatedAt:   commit.Committer.When,
	}
}

func parseCommitMessage(message string) (string, map[string][]string) {
	message = strings.ReplaceAll(message, "\r\n", "\n")
	lines := strings.Split(message, "\n")
	summary := ""
	if len(lines) > 0 {
		summary = strings.TrimSpace(lines[0])
	}
	trailers := map[string][]string{}
	for _, line := range lines[1:] {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		trailers[key] = append(trailers[key], value)
	}
	return summary, trailers
}

func firstTrailer(trailers map[string][]string, key string) string {
	values := trailers[key]
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func isMarkdownPath(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".md")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func uniqueSorted(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func normalizeTags(tags []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		result = append(result, tag)
	}
	return result
}

func diffContentLines(from string, to string) []DiffLine {
	oldLines := splitDiffLines(from)
	newLines := splitDiffLines(to)
	table := lcsTable(oldLines, newLines)
	lines := []DiffLine{}
	oldIndex := 0
	newIndex := 0
	for oldIndex < len(oldLines) && newIndex < len(newLines) {
		switch {
		case oldLines[oldIndex] == newLines[newIndex]:
			lines = append(lines, DiffLine{
				Type:    "context",
				OldLine: oldIndex + 1,
				NewLine: newIndex + 1,
				Text:    oldLines[oldIndex],
			})
			oldIndex++
			newIndex++
		case table[oldIndex+1][newIndex] >= table[oldIndex][newIndex+1]:
			lines = append(lines, DiffLine{
				Type:    "removed",
				OldLine: oldIndex + 1,
				Text:    oldLines[oldIndex],
			})
			oldIndex++
		default:
			lines = append(lines, DiffLine{
				Type:    "added",
				NewLine: newIndex + 1,
				Text:    newLines[newIndex],
			})
			newIndex++
		}
	}
	for oldIndex < len(oldLines) {
		lines = append(lines, DiffLine{
			Type:    "removed",
			OldLine: oldIndex + 1,
			Text:    oldLines[oldIndex],
		})
		oldIndex++
	}
	for newIndex < len(newLines) {
		lines = append(lines, DiffLine{
			Type:    "added",
			NewLine: newIndex + 1,
			Text:    newLines[newIndex],
		})
		newIndex++
	}
	return lines
}

func lcsTable(oldLines []string, newLines []string) [][]int {
	table := make([][]int, len(oldLines)+1)
	for index := range table {
		table[index] = make([]int, len(newLines)+1)
	}
	for oldIndex := len(oldLines) - 1; oldIndex >= 0; oldIndex-- {
		for newIndex := len(newLines) - 1; newIndex >= 0; newIndex-- {
			if oldLines[oldIndex] == newLines[newIndex] {
				table[oldIndex][newIndex] = table[oldIndex+1][newIndex+1] + 1
				continue
			}
			table[oldIndex][newIndex] = table[oldIndex+1][newIndex]
			if table[oldIndex][newIndex+1] > table[oldIndex][newIndex] {
				table[oldIndex][newIndex] = table[oldIndex][newIndex+1]
			}
		}
	}
	return table
}

func splitDiffLines(content string) []string {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.TrimSuffix(content, "\n")
	if content == "" {
		return []string{}
	}
	return strings.Split(content, "\n")
}

var errStopIteration = errors.New("stop iterating")
