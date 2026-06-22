package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
)

const (
	defaultWorkspaceWatcherRefreshInterval = 2 * time.Second
	workspaceWatcherDebounceInterval       = 150 * time.Millisecond
)

type workspaceFileWatcher struct {
	api             *apiHandler
	watcher         *fsnotify.Watcher
	refreshInterval time.Duration

	mu             sync.Mutex
	projectRootDir map[string]string
	watchedDirs    map[string]string
	pendingTimers  map[string]*time.Timer
}

func (handler *apiHandler) startWorkspaceFileWatcher(config Config) {
	refreshInterval := config.WorkspaceWatcherInterval
	if refreshInterval <= 0 {
		refreshInterval = defaultWorkspaceWatcherRefreshInterval
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		slog.Warn("native workspace file watcher unavailable; falling back to backend polling", "error", err)
		ctx := handler.shutdownContext()
		handler.workers.Add(1)
		go func() {
			defer handler.workers.Done()
			handler.runWorkspaceFilePollingWatcher(ctx, refreshInterval)
		}()
		return
	}

	fileWatcher := &workspaceFileWatcher{
		api:             handler,
		watcher:         watcher,
		refreshInterval: refreshInterval,
		projectRootDir:  map[string]string{},
		watchedDirs:     map[string]string{},
		pendingTimers:   map[string]*time.Timer{},
	}
	ctx := handler.shutdownContext()
	handler.workers.Add(1)
	go func() {
		defer handler.workers.Done()
		fileWatcher.run(ctx)
	}()
}

func (watcher *workspaceFileWatcher) run(ctx context.Context) {
	defer watcher.watcher.Close()
	defer watcher.stopPendingTimers()
	watcher.refreshProjectWatches()

	ticker := time.NewTicker(watcher.refreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.watcher.Events:
			if !ok {
				return
			}
			watcher.handleEvent(event)
		case err, ok := <-watcher.watcher.Errors:
			if !ok {
				return
			}
			slog.Warn("workspace file watcher error", "error", err)
		case <-ticker.C:
			watcher.refreshProjectWatches()
		}
	}
}

func (watcher *workspaceFileWatcher) handleEvent(event fsnotify.Event) {
	if event.Name == "" || !isWorkspaceFileChange(event) || shouldIgnoreWatcherEntry(filepath.Base(event.Name)) {
		return
	}
	projectID := watcher.projectIDForPath(event.Name)
	if projectID == "" {
		return
	}
	if event.Has(fsnotify.Create) {
		watcher.watchCreatedDirectory(projectID, event.Name)
	}
	watcher.scheduleProjectSync(projectID)
}

func (watcher *workspaceFileWatcher) watchCreatedDirectory(projectID string, path string) {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return
	}
	if err := watcher.watchProjectRoot(projectID, path); err != nil {
		slog.Warn("watching created workspace directory failed", "project_id", projectID, "path", path, "error", err)
	}
}

func (watcher *workspaceFileWatcher) scheduleProjectSync(projectID string) {
	projectID = domain.CleanProjectID(projectID)
	if projectID == "" {
		return
	}

	watcher.mu.Lock()
	if timer, ok := watcher.pendingTimers[projectID]; ok {
		timer.Stop()
		timer.Reset(workspaceWatcherDebounceInterval)
		watcher.mu.Unlock()
		return
	}
	watcher.pendingTimers[projectID] = time.AfterFunc(workspaceWatcherDebounceInterval, func() {
		watcher.flushProjectSync(projectID)
	})
	watcher.mu.Unlock()
}

func (watcher *workspaceFileWatcher) stopPendingTimers() {
	watcher.mu.Lock()
	defer watcher.mu.Unlock()
	for projectID, timer := range watcher.pendingTimers {
		timer.Stop()
		delete(watcher.pendingTimers, projectID)
	}
}

func (watcher *workspaceFileWatcher) flushProjectSync(projectID string) {
	watcher.mu.Lock()
	delete(watcher.pendingTimers, projectID)
	watcher.mu.Unlock()

	if _, err := watcher.api.workspaceState.SyncLocalMarkdownFiles(projectID); err != nil {
		slog.Warn("workspace file watcher document sync failed", "project_id", projectID, "error", err)
	}
	watcher.api.publishWorkspaceDocumentsChanged(projectID)
	if err := watcher.refreshProjectWatch(projectID); err != nil {
		slog.Warn("workspace file watcher refresh failed", "project_id", projectID, "error", err)
	}
}

func (watcher *workspaceFileWatcher) refreshProjectWatches() {
	projects, err := watcher.api.workspaceState.ListProjects()
	if err != nil {
		slog.Warn("workspace file watcher project list failed", "error", err)
		return
	}

	seen := map[string]bool{}
	for _, project := range projects.Projects {
		projectID := domain.CleanProjectID(project.ID)
		if projectID == "" {
			continue
		}
		seen[projectID] = true
		if err := watcher.refreshProjectWatch(projectID); err != nil {
			slog.Warn("workspace file watcher project refresh failed", "project_id", projectID, "error", err)
		}
	}
	watcher.removeStaleProjectWatches(seen)
}

func (watcher *workspaceFileWatcher) refreshProjectWatch(projectID string) error {
	projectDir, err := watcher.api.workspaceState.StateService().Documents.ProjectDir(projectID)
	if err != nil {
		return err
	}
	workDir := filepath.Join(projectDir, "work")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return err
	}
	return watcher.watchProjectRoot(projectID, workDir)
}

func (watcher *workspaceFileWatcher) watchProjectRoot(projectID string, root string) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	root = filepath.Clean(root)

	watcher.mu.Lock()
	watcher.projectRootDir[projectID] = root
	watcher.mu.Unlock()

	return filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			slog.Warn("walking workspace watch directory failed", "project_id", projectID, "path", path, "error", err)
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && shouldIgnoreWatcherEntry(entry.Name()) {
			return filepath.SkipDir
		}
		if err := watcher.watchDirectory(projectID, path); err != nil {
			slog.Warn("adding workspace watch directory failed", "project_id", projectID, "path", path, "error", err)
		}
		return nil
	})
}

func (watcher *workspaceFileWatcher) watchDirectory(projectID string, path string) error {
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	path = filepath.Clean(path)

	watcher.mu.Lock()
	if existingProjectID, ok := watcher.watchedDirs[path]; ok && existingProjectID == projectID {
		watcher.mu.Unlock()
		return nil
	}
	watcher.watchedDirs[path] = projectID
	watcher.mu.Unlock()

	if err := watcher.watcher.Add(path); err != nil {
		watcher.mu.Lock()
		delete(watcher.watchedDirs, path)
		watcher.mu.Unlock()
		return err
	}
	return nil
}

func (watcher *workspaceFileWatcher) removeStaleProjectWatches(seen map[string]bool) {
	staleDirs := []string{}
	watcher.mu.Lock()
	for path, projectID := range watcher.watchedDirs {
		if !seen[projectID] {
			staleDirs = append(staleDirs, path)
			delete(watcher.watchedDirs, path)
		}
	}
	for projectID := range watcher.projectRootDir {
		if !seen[projectID] {
			delete(watcher.projectRootDir, projectID)
		}
	}
	watcher.mu.Unlock()

	for _, path := range staleDirs {
		if err := watcher.watcher.Remove(path); err != nil {
			slog.Debug("removing stale workspace watch directory failed", "path", path, "error", err)
		}
	}
}

func (watcher *workspaceFileWatcher) projectIDForPath(path string) string {
	path, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	path = filepath.Clean(path)

	watcher.mu.Lock()
	defer watcher.mu.Unlock()
	for projectID, root := range watcher.projectRootDir {
		if path == root || strings.HasPrefix(path, root+string(filepath.Separator)) {
			return projectID
		}
	}
	return ""
}

func (handler *apiHandler) runWorkspaceFilePollingWatcher(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = defaultWorkspaceWatcherRefreshInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	signatures := map[string]string{}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			handler.syncWorkspaceLocalFilesOnce(signatures)
		}
	}
}

func (handler *apiHandler) syncWorkspaceLocalFilesOnce(signatures map[string]string) {
	projects, err := handler.workspaceState.ListProjects()
	if err != nil {
		slog.Warn("workspace file polling project list failed", "error", err)
		return
	}
	for _, project := range projects.Projects {
		projectID := domain.CleanProjectID(project.ID)
		if projectID == "" {
			continue
		}
		projectDir, err := handler.workspaceState.StateService().Documents.ProjectDir(projectID)
		if err != nil {
			slog.Warn("workspace file polling project directory failed", "project_id", projectID, "error", err)
			continue
		}
		signature, err := workspaceLocalTreeSignature(filepath.Join(projectDir, "work"))
		if err != nil {
			slog.Warn("workspace file polling signature failed", "project_id", projectID, "error", err)
			continue
		}
		if previous, ok := signatures[projectID]; ok && previous != signature {
			if _, err := handler.workspaceState.SyncLocalMarkdownFiles(projectID); err != nil {
				slog.Warn("workspace file polling document sync failed", "project_id", projectID, "error", err)
			}
			handler.publishWorkspaceDocumentsChanged(projectID)
		}
		signatures[projectID] = signature
	}
}

func isWorkspaceFileChange(event fsnotify.Event) bool {
	return event.Has(fsnotify.Create) ||
		event.Has(fsnotify.Write) ||
		event.Has(fsnotify.Remove) ||
		event.Has(fsnotify.Rename)
}

func shouldIgnoreWatcherEntry(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || strings.HasPrefix(name, ".") {
		return true
	}
	lower := strings.ToLower(name)
	if lower == ".ds_store" || lower == "thumbs.db" {
		return true
	}
	return strings.HasSuffix(lower, "~") ||
		strings.HasSuffix(lower, ".tmp") ||
		strings.HasSuffix(lower, ".temp") ||
		strings.HasSuffix(lower, ".swp") ||
		strings.HasSuffix(lower, ".part")
}

func workspaceLocalTreeSignature(root string) (string, error) {
	hasher := sha1.New()
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if path != root && shouldIgnoreWatcherEntry(entry.Name()) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.IsDir() && strings.ToLower(filepath.Ext(entry.Name())) != ".md" {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		kind := "file"
		if entry.IsDir() {
			kind = "dir"
		}
		_, _ = fmt.Fprintf(
			hasher,
			"%s\t%s\t%d\t%d\n",
			kind,
			filepath.ToSlash(relative),
			info.Size(),
			info.ModTime().UnixNano(),
		)
		return nil
	}); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
