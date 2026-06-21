package media

import (
	"bytes"
	"context"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/mediago-dev/mediago-drama/services/server/internal/config"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

func TestNewMediaAssetsDefaultDBPathUsesWorkspaceAppDB(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(homeDir, ".config"))
	t.Setenv("APPDATA", filepath.Join(homeDir, "AppData", "Roaming"))

	store := NewMediaAssets("", filepath.Join(t.TempDir(), "media"))
	if store.initErr != nil {
		t.Fatalf("NewMediaAssets() initErr = %v", store.initErr)
	}
	if _, err := os.Stat(shared.WorkspacePathsFor("").DatabasePath()); err != nil {
		t.Fatalf("workspace app.db was not created: %v", err)
	}
	if _, err := os.Stat(config.DefaultSettingsDBPath()); !os.IsNotExist(err) {
		t.Fatalf("settings db exists after media default path open: %v", err)
	}
}

func TestSaveBase64StoresGeneratedAssetsByProject(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	workspaceRepos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := requireMediaTestProject(t, workspaceRepos.Workspace, "alpha")
	store := NewMediaAssetsFromRepository(workspaceRepos.MediaAssets, globalDir, workspaceRoot, workspaceRepos.Workspace, nil)

	encoded := base64.StdEncoding.EncodeToString([]byte("image-bytes"))
	projectAsset, err := store.SaveBase64(MediaKindImage, "image/png", encoded, "", "alpha")
	if err != nil {
		t.Fatalf("SaveBase64(project) error = %v", err)
	}
	globalAsset, err := store.SaveBase64(MediaKindImage, "image/png", encoded, "", "")
	if err != nil {
		t.Fatalf("SaveBase64(global) error = %v", err)
	}

	wantProjectDir := mediaAssetTestDateDir(projectAsset, filepath.Join(projectDir, "library"))
	if got := filepath.Dir(projectAsset.FilePath); got != wantProjectDir {
		t.Fatalf("project asset dir = %q, want %q", got, wantProjectDir)
	}
	wantGlobalDir := mediaAssetTestDateDir(globalAsset, globalDir)
	if got := filepath.Dir(globalAsset.FilePath); got != wantGlobalDir {
		t.Fatalf("global asset dir = %q, want %q", got, wantGlobalDir)
	}
	if projectAsset.Source != MediaSourceGeneration || projectAsset.RelativePath == "" {
		t.Fatalf("project asset source/path = %q/%q, want generation and relative path", projectAsset.Source, projectAsset.RelativePath)
	}
	if projectAsset.ProjectID != "alpha" {
		t.Fatalf("project asset ProjectID = %q, want alpha", projectAsset.ProjectID)
	}
	if globalAsset.ProjectID != "" {
		t.Fatalf("global asset ProjectID = %q, want empty", globalAsset.ProjectID)
	}
	if _, err := os.Stat(projectAsset.FilePath); err != nil {
		t.Fatalf("project asset was not written: %v", err)
	}
	if _, err := os.Stat(globalAsset.FilePath); err != nil {
		t.Fatalf("global asset was not written: %v", err)
	}

	studioAssets, err := store.List("")
	if err != nil {
		t.Fatalf("List(studio) error = %v", err)
	}
	if len(studioAssets) != 1 || studioAssets[0].ID != globalAsset.ID {
		t.Fatalf("studio assets = %#v, want global asset only", studioAssets)
	}

	projectAssets, err := store.List("alpha")
	if err != nil {
		t.Fatalf("List(project) error = %v", err)
	}
	if len(projectAssets) != 2 {
		t.Fatalf("project assets len = %d, want 2", len(projectAssets))
	}
}

func TestSaveMultipartFileStoresUploadsByProject(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	workspaceRepos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := requireMediaTestProject(t, workspaceRepos.Workspace, "alpha")
	store := NewMediaAssetsFromRepository(workspaceRepos.MediaAssets, globalDir, workspaceRoot, workspaceRepos.Workspace, nil)

	header := multipartFileHeader(t, "upload.png", []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	asset, err := store.SaveMultipartFile(header, "alpha")
	if err != nil {
		t.Fatalf("SaveMultipartFile() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, filepath.Join(projectDir, "library"))
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("uploaded asset dir = %q, want %q", got, wantDir)
	}
	if asset.ProjectID != "alpha" {
		t.Fatalf("uploaded asset ProjectID = %q, want alpha", asset.ProjectID)
	}
	if asset.Source != MediaSourceUpload {
		t.Fatalf("uploaded asset Source = %q, want %q", asset.Source, MediaSourceUpload)
	}
}

func TestSaveWithOptionsStoresToolboxGenerationByConversation(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)

	asset, err := store.SaveBase64WithOptions(
		MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		MediaAssetSaveOptions{Source: MediaSourceToolbox, ConversationID: "conversation-1"},
	)
	if err != nil {
		t.Fatalf("SaveBase64WithOptions() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, globalDir)
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("toolbox asset dir = %q, want %q", got, wantDir)
	}
	if asset.Source != MediaSourceToolbox || asset.ConversationID != "conversation-1" {
		t.Fatalf("toolbox source/conversation = %q/%q", asset.Source, asset.ConversationID)
	}
}

func TestSaveTextWithOptionsStoresToolboxTextAsset(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)

	asset, err := store.SaveTextWithOptions(
		"一段文本结果",
		"scene.txt",
		"",
		MediaAssetSaveOptions{Source: MediaSourceToolbox, ConversationID: "conversation-1"},
	)
	if err != nil {
		t.Fatalf("SaveTextWithOptions() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, globalDir)
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("toolbox text dir = %q, want %q", got, wantDir)
	}
	if asset.Kind != MediaKindText || asset.MIMEType != "text/plain" {
		t.Fatalf("text asset kind/mime = %q/%q, want text/text/plain", asset.Kind, asset.MIMEType)
	}
	if asset.Source != MediaSourceToolbox || asset.ConversationID != "conversation-1" {
		t.Fatalf("text source/conversation = %q/%q", asset.Source, asset.ConversationID)
	}
	data, err := os.ReadFile(asset.FilePath)
	if err != nil {
		t.Fatalf("reading text asset: %v", err)
	}
	if string(data) != "一段文本结果" {
		t.Fatalf("text asset content = %q", string(data))
	}
	assets, err := store.List("")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 || assets[0].ID != asset.ID || assets[0].Kind != MediaKindText {
		t.Fatalf("listed assets = %#v, want stored text asset", assets)
	}
}

func TestSaveTextWithOptionsReusesConversationScopedContentHash(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	options := MediaAssetSaveOptions{Source: MediaSourceToolbox, ConversationID: "conversation-1"}

	first, err := store.SaveTextWithOptions("same result", "first.txt", "", options)
	if err != nil {
		t.Fatalf("SaveTextWithOptions(first) error = %v", err)
	}
	second, err := store.SaveTextWithOptions("same result", "second.txt", "", options)
	if err != nil {
		t.Fatalf("SaveTextWithOptions(second) error = %v", err)
	}

	if first.ID != second.ID || first.FilePath != second.FilePath {
		t.Fatalf("second text asset = %#v, want reused first asset %#v", second, first)
	}
	assets, err := store.List("")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("assets len = %d, want 1", len(assets))
	}
}

func TestSaveRemoteAssetWithOptionsReusesConversationScopedSourceURL(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.Header().Set("Content-Type", "image/png")
		_, _ = response.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	}))
	defer server.Close()
	options := MediaAssetSaveOptions{Source: MediaSourceToolbox, ConversationID: "conversation-1"}

	first, err := store.SaveRemoteAssetWithOptions(context.Background(), MediaKindImage, server.URL+"/image.png", options)
	if err != nil {
		t.Fatalf("SaveRemoteAssetWithOptions(first) error = %v", err)
	}
	second, err := store.SaveRemoteAssetWithOptions(context.Background(), MediaKindImage, server.URL+"/image.png", options)
	if err != nil {
		t.Fatalf("SaveRemoteAssetWithOptions(second) error = %v", err)
	}

	if first.ID != second.ID || first.FilePath != second.FilePath {
		t.Fatalf("second asset = %#v, want reused first asset %#v", second, first)
	}
	if requests != 1 {
		t.Fatalf("remote requests = %d, want 1", requests)
	}
	assets, err := store.List("")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("assets len = %d, want 1", len(assets))
	}
}

func TestSaveRemoteAssetWithOptionsReusesConversationScopedContentHashAcrossURLs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake media tool scripts are POSIX shell scripts")
	}

	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	store.SetMediaToolPaths("", fakeMediaToolsDir(t))
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.Header().Set("Content-Type", "video/mp4")
		_, _ = response.Write([]byte("same-video-bytes"))
	}))
	defer server.Close()
	options := MediaAssetSaveOptions{Source: MediaSourceToolbox, ConversationID: "conversation-1"}

	first, err := store.SaveRemoteAssetWithOptions(context.Background(), MediaKindVideo, server.URL+"/video-a.m4v", options)
	if err != nil {
		t.Fatalf("SaveRemoteAssetWithOptions(first) error = %v", err)
	}
	second, err := store.SaveRemoteAssetWithOptions(context.Background(), MediaKindVideo, server.URL+"/video-b.m4v", options)
	if err != nil {
		t.Fatalf("SaveRemoteAssetWithOptions(second) error = %v", err)
	}

	if first.ID != second.ID || first.FilePath != second.FilePath {
		t.Fatalf("second video asset = %#v, want reused first asset %#v", second, first)
	}
	if requests != 2 {
		t.Fatalf("remote requests = %d, want 2 because URLs differ and content must be inspected", requests)
	}
	assets, err := store.List("")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("assets len = %d, want 1", len(assets))
	}
}

func TestSaveRemoteAssetWithOptionsReusesAcrossConversations(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "image/png")
		_, _ = response.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	}))
	defer server.Close()

	first, err := store.SaveRemoteAssetWithOptions(
		context.Background(),
		MediaKindImage,
		server.URL+"/image.png",
		MediaAssetSaveOptions{Source: MediaSourceToolbox, ConversationID: "conversation-1"},
	)
	if err != nil {
		t.Fatalf("SaveRemoteAssetWithOptions(first) error = %v", err)
	}
	second, err := store.SaveRemoteAssetWithOptions(
		context.Background(),
		MediaKindImage,
		server.URL+"/image.png",
		MediaAssetSaveOptions{Source: MediaSourceToolbox, ConversationID: "conversation-2"},
	)
	if err != nil {
		t.Fatalf("SaveRemoteAssetWithOptions(second) error = %v", err)
	}

	if first.ID != second.ID || first.FilePath != second.FilePath {
		t.Fatalf("second asset = %#v, want reused content/source asset from %#v", second, first)
	}
}

func TestSaveWithOptionsStoresProjectSectionImagesByDocumentAndBlock(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	workspaceRepos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := requireMediaTestProject(t, workspaceRepos.Workspace, "alpha")
	store := NewMediaAssetsFromRepository(workspaceRepos.MediaAssets, globalDir, workspaceRoot, workspaceRepos.Workspace, nil)

	asset, err := store.SaveBase64WithOptions(
		MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		MediaAssetSaveOptions{
			ProjectID:      "alpha",
			Source:         MediaSourceGeneration,
			ConversationID: "conversation-1",
			SectionID:      "document%201:block%2F2",
		},
	)
	if err != nil {
		t.Fatalf("SaveBase64WithOptions() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, filepath.Join(projectDir, "library"))
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("section image dir = %q, want %q", got, wantDir)
	}
	if asset.RelativePath != mediaAssetTestRelativePath(asset) {
		t.Fatalf("RelativePath = %q", asset.RelativePath)
	}
}

func TestSaveWithOptionsStoresProjectNonSectionMediaByConversation(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	workspaceRepos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	projectDir := requireMediaTestProject(t, workspaceRepos.Workspace, "alpha")
	store := NewMediaAssetsFromRepository(workspaceRepos.MediaAssets, globalDir, workspaceRoot, workspaceRepos.Workspace, nil)

	asset, err := store.SaveBase64WithOptions(
		MediaKindVideo,
		"video/mp4",
		base64.StdEncoding.EncodeToString([]byte("video-bytes")),
		"",
		MediaAssetSaveOptions{
			ProjectID:      "alpha",
			Source:         MediaSourceGeneration,
			ConversationID: "conversation-1",
			SectionID:      "document-a:block-a",
		},
	)
	if err != nil {
		t.Fatalf("SaveBase64WithOptions() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, filepath.Join(projectDir, "library"))
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("project video dir = %q, want %q", got, wantDir)
	}
}

func TestSaveGeneratedAssetFileCopiesLocalAssetByID(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	asset, err := store.SaveBase64(
		MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		"",
	)
	if err != nil {
		t.Fatalf("SaveBase64() error = %v", err)
	}

	exportDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(exportDir, "scene.png"), []byte("existing"), 0o600); err != nil {
		t.Fatalf("writing existing export: %v", err)
	}
	saved, err := store.SaveGeneratedAssetFile(context.Background(), GeneratedAssetFileSaveRequest{
		Directory: exportDir,
		Filename:  "scene.png",
		AssetID:   asset.ID,
		Kind:      MediaKindImage,
	})
	if err != nil {
		t.Fatalf("SaveGeneratedAssetFile() error = %v", err)
	}

	if saved.Filename != "scene-2.png" {
		t.Fatalf("saved filename = %q, want scene-2.png", saved.Filename)
	}
	data, err := os.ReadFile(saved.Path)
	if err != nil {
		t.Fatalf("reading saved file: %v", err)
	}
	if string(data) != "image-bytes" {
		t.Fatalf("saved data = %q, want image-bytes", data)
	}
}

func TestSaveBase64VideoStoresDerivedMetadataAndPoster(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake media tool scripts are POSIX shell scripts")
	}

	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	store.SetMediaToolPaths("", fakeMediaToolsDir(t))

	asset, err := store.SaveBase64(
		MediaKindVideo,
		"video/mp4",
		base64.StdEncoding.EncodeToString([]byte("video-bytes")),
		"",
		"",
	)
	if err != nil {
		t.Fatalf("SaveBase64(video) error = %v", err)
	}

	if asset.DurationSeconds != 6.25 {
		t.Fatalf("DurationSeconds = %v, want 6.25", asset.DurationSeconds)
	}
	if asset.Width != 1920 || asset.Height != 1080 {
		t.Fatalf("dimensions = %dx%d, want 1920x1080", asset.Width, asset.Height)
	}
	if asset.MetadataStatus != MetadataStatusReady {
		t.Fatalf("MetadataStatus = %q, want %q", asset.MetadataStatus, MetadataStatusReady)
	}
	if asset.PosterURL == "" || asset.PosterPath == "" {
		t.Fatalf("poster metadata missing: url=%q path=%q", asset.PosterURL, asset.PosterPath)
	}
	if _, err := os.Stat(asset.PosterPath); err != nil {
		t.Fatalf("poster was not written: %v", err)
	}
	if got, want := filepath.Dir(asset.PosterPath), shared.WorkspacePathsFor(workspaceRoot).MediaPosterCacheDir(); got != want {
		t.Fatalf("poster dir = %q, want %q", got, want)
	}
	if visiblePoster := filepath.Join(filepath.Dir(asset.FilePath), asset.ID+".poster.jpg"); visiblePoster == asset.PosterPath {
		t.Fatalf("poster path should not be inside visible library dir: %s", visiblePoster)
	} else if _, err := os.Stat(visiblePoster); !os.IsNotExist(err) {
		t.Fatalf("visible poster should not exist at %s, err=%v", visiblePoster, err)
	}

	got, ok, err := store.Get(asset.ID)
	if err != nil {
		t.Fatalf("Get(video asset) error = %v", err)
	}
	if !ok {
		t.Fatal("Get(video asset) ok = false, want true")
	}
	if got.DurationSeconds != asset.DurationSeconds || got.PosterPath != asset.PosterPath {
		t.Fatalf("persisted metadata = %#v, want duration/poster from %#v", got, asset)
	}
}

func TestListBackfillsHistoricalVideoMetadata(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake media tool scripts are POSIX shell scripts")
	}

	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	if err := os.MkdirAll(globalDir, 0o755); err != nil {
		t.Fatalf("creating media dir: %v", err)
	}
	filePath := filepath.Join(globalDir, "historical.mp4")
	if err := os.WriteFile(filePath, []byte("old-video-bytes"), 0o600); err != nil {
		t.Fatalf("writing historical video: %v", err)
	}

	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	if err := repo.CreateMediaAsset(domain.AssetModel{
		ID:        "asset-historical",
		Kind:      MediaKindVideo,
		Filename:  "historical.mp4",
		MIMEType:  "video/mp4",
		SizeBytes: 15,
		RelPath:   "historical.mp4",
		URL:       "/api/v1/media-assets/asset-historical/content",
		CreatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
		UpdatedAt: domain.TimeFromString("2026-05-22T00:00:00Z"),
	}); err != nil {
		t.Fatalf("CreateMediaAsset() error = %v", err)
	}

	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	store.SetMediaToolPaths("", fakeMediaToolsDir(t))

	assets, err := store.List("")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("List() len = %d, want 1", len(assets))
	}
	asset := assets[0]
	if asset.DurationSeconds != 6.25 || asset.Width != 1920 || asset.Height != 1080 {
		t.Fatalf("backfilled metadata = duration %v dimensions %dx%d, want 6.25 1920x1080", asset.DurationSeconds, asset.Width, asset.Height)
	}
	if asset.MetadataStatus != MetadataStatusReady || asset.PosterURL == "" {
		t.Fatalf("backfilled status/poster = %q/%q, want ready and poster", asset.MetadataStatus, asset.PosterURL)
	}
	if got, want := filepath.Dir(asset.PosterPath), shared.WorkspacePathsFor(workspaceRoot).MediaPosterCacheDir(); got != want {
		t.Fatalf("backfilled poster dir = %q, want %q", got, want)
	}
	visiblePoster := filepath.Join(filepath.Dir(filePath), "asset-historical.poster.jpg")
	if _, err := os.Stat(visiblePoster); !os.IsNotExist(err) {
		t.Fatalf("visible backfill poster should not exist at %s, err=%v", visiblePoster, err)
	}

	got, err := repo.GetMediaAsset("asset-historical")
	if err != nil {
		t.Fatalf("GetMediaAsset() error = %v", err)
	}
	if got.DurationSeconds != 6.25 || got.PosterRelPath == "" || filepath.IsAbs(got.PosterRelPath) {
		t.Fatalf("persisted historical metadata = %#v, want duration and poster path", got)
	}
}

func TestListMovesVisibleVideoPosterToHiddenCache(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake media tool scripts are POSIX shell scripts")
	}

	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	dateDir := filepath.Join(globalDir, "2026-06-21")
	if err := os.MkdirAll(dateDir, 0o755); err != nil {
		t.Fatalf("creating media dir: %v", err)
	}
	filePath := filepath.Join(dateDir, "asset-ready.mp4")
	if err := os.WriteFile(filePath, []byte("video-bytes"), 0o600); err != nil {
		t.Fatalf("writing video: %v", err)
	}
	visiblePosterPath := filepath.Join(dateDir, "asset-ready.poster.jpg")
	if err := os.WriteFile(visiblePosterPath, []byte("old-poster"), 0o600); err != nil {
		t.Fatalf("writing visible poster: %v", err)
	}

	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	if err := repo.CreateMediaAsset(domain.AssetModel{
		ID:              "asset-ready",
		Kind:            MediaKindVideo,
		Filename:        "ready.mp4",
		MIMEType:        "video/mp4",
		SizeBytes:       11,
		RelPath:         "2026-06-21/asset-ready.mp4",
		URL:             "/api/v1/media-assets/asset-ready/content",
		DurationSeconds: 6.25,
		Width:           1920,
		Height:          1080,
		PosterRelPath:   "2026-06-21/asset-ready.poster.jpg",
		PosterURL:       "/api/v1/media-assets/asset-ready/poster",
		MetadataStatus:  MetadataStatusReady,
		CreatedAt:       domain.TimeFromString("2026-06-21T00:00:00Z"),
		UpdatedAt:       domain.TimeFromString("2026-06-21T00:00:00Z"),
	}); err != nil {
		t.Fatalf("CreateMediaAsset() error = %v", err)
	}

	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)
	store.SetMediaToolPaths("", fakeMediaToolsDir(t))

	assets, err := store.List("")
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("List() len = %d, want 1", len(assets))
	}
	asset := assets[0]
	wantPosterPath := filepath.Join(shared.WorkspacePathsFor(workspaceRoot).MediaPosterCacheDir(), "asset-ready.poster.jpg")
	if asset.PosterPath != wantPosterPath {
		t.Fatalf("poster path = %q, want %q", asset.PosterPath, wantPosterPath)
	}
	if _, err := os.Stat(wantPosterPath); err != nil {
		t.Fatalf("hidden poster should exist: %v", err)
	}
	if _, err := os.Stat(visiblePosterPath); !os.IsNotExist(err) {
		t.Fatalf("visible poster should be removed, err=%v", err)
	}

	got, err := repo.GetMediaAsset("asset-ready")
	if err != nil {
		t.Fatalf("GetMediaAsset() error = %v", err)
	}
	wantPosterRelPath := store.mediaAssetDBRelPath("", wantPosterPath)
	if got.PosterRelPath != wantPosterRelPath {
		t.Fatalf("persisted poster rel_path = %q, want %q", got.PosterRelPath, wantPosterRelPath)
	}
}

func TestSaveBase64StoresGeneratedAssetsByStudioSession(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)

	asset, err := store.SaveBase64ForStudioSession(
		MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		"conversation-1",
	)
	if err != nil {
		t.Fatalf("SaveBase64ForStudioSession() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, globalDir)
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("studio asset dir = %q, want %q", got, wantDir)
	}
	if asset.ProjectID != "" {
		t.Fatalf("studio asset ProjectID = %q, want empty", asset.ProjectID)
	}
	if _, err := os.Stat(asset.FilePath); err != nil {
		t.Fatalf("studio asset was not written: %v", err)
	}
}

func TestSaveBase64StoresGeneratedAssetsByStudioDir(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	repo, err := repository.NewMediaAssetRepository(filepath.Join(t.TempDir(), "settings.db"))
	if err != nil {
		t.Fatalf("NewMediaAssetRepository() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(repo, globalDir, workspaceRoot, nil, nil)

	studioDir := shared.WorkspacePathsFor(workspaceRoot).StudioGenerationSessionDir("image", "conversation-1", "2026-06-06T12:00:00Z")
	asset, err := store.SaveBase64ForStudioDir(
		MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		studioDir,
	)
	if err != nil {
		t.Fatalf("SaveBase64ForStudioDir() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, globalDir)
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("studio asset dir = %q, want %q", got, wantDir)
	}
	if asset.ProjectID != "" {
		t.Fatalf("studio asset ProjectID = %q, want empty", asset.ProjectID)
	}
	if _, err := os.Stat(asset.FilePath); err != nil {
		t.Fatalf("studio asset was not written: %v", err)
	}
}

func TestServeFilePathRejectsPathsOutsideAllowedRoots(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	outsideDir := t.TempDir()
	store := &MediaAssets{dir: globalDir, workspaceRoot: workspaceRoot}

	for _, filePath := range []string{
		filepath.Join(globalDir, "image.png"),
		filepath.Join(shared.WorkspacePathsFor(workspaceRoot).StudioSessionDir(""), "image-generation", "image.png"),
	} {
		resolved, err := store.ServeFilePath(MediaAsset{ID: "asset", FilePath: filePath})
		if err != nil {
			t.Fatalf("ServeFilePath(%q) returned error: %v", filePath, err)
		}
		want, err := filepath.Abs(filePath)
		if err != nil {
			t.Fatalf("Abs(%q) returned error: %v", filePath, err)
		}
		if resolved != want {
			t.Fatalf("ServeFilePath(%q) = %q, want %q", filePath, resolved, want)
		}
	}

	if _, err := store.ServeFilePath(MediaAsset{
		ID:       "outside",
		FilePath: filepath.Join(outsideDir, "secret.png"),
	}); err == nil {
		t.Fatal("ServeFilePath outside allowed roots returned nil error")
	}
}

func TestServePosterFilePathRejectsPathsOutsideAllowedRoots(t *testing.T) {
	workspaceRoot := t.TempDir()
	globalDir := filepath.Join(workspaceRoot, "library")
	outsideDir := t.TempDir()
	store := &MediaAssets{dir: globalDir, workspaceRoot: workspaceRoot}

	posterPath := filepath.Join(globalDir, "video.poster.jpg")
	resolved, err := store.ServePosterFilePath(MediaAsset{ID: "asset", PosterPath: posterPath})
	if err != nil {
		t.Fatalf("ServePosterFilePath() returned error: %v", err)
	}
	want, err := filepath.Abs(posterPath)
	if err != nil {
		t.Fatalf("Abs(%q) returned error: %v", posterPath, err)
	}
	if resolved != want {
		t.Fatalf("ServePosterFilePath() = %q, want %q", resolved, want)
	}

	if _, err := store.ServePosterFilePath(MediaAsset{
		ID:         "outside",
		PosterPath: filepath.Join(outsideDir, "secret.jpg"),
	}); err == nil {
		t.Fatal("ServePosterFilePath outside allowed roots returned nil error")
	}
}

func requireMediaTestProject(t *testing.T, repo *repository.WorkspaceRepository, projectID string) string {
	t.Helper()
	projectDir := filepath.Join(t.TempDir(), projectID)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}
	if err := repo.UpsertProject(domain.WorkspaceProjectModel{
		ID:          projectID,
		Name:        projectID,
		ProjectDir:  projectDir,
		RelativeDir: projectDir,
		CreatedAt:   domain.TimeFromString("2026-06-02T00:00:00Z"),
		UpdatedAt:   domain.TimeFromString("2026-06-02T00:00:00Z"),
	}); err != nil {
		t.Fatalf("UpsertProject(%s) error = %v", projectID, err)
	}
	return projectDir
}

func TestSaveBase64UsesPersistedProjectDir(t *testing.T) {
	workspaceRoot := t.TempDir()
	customProjectDir := filepath.Join(t.TempDir(), "custom-project")
	globalDir := filepath.Join(workspaceRoot, "library")
	workspaceRepos, err := repository.OpenWorkspaceRepositories(filepath.Join(t.TempDir(), "workspace.db"))
	if err != nil {
		t.Fatalf("OpenWorkspaceRepositories() error = %v", err)
	}
	if err := workspaceRepos.Workspace.UpsertProject(domain.WorkspaceProjectModel{
		ID:          "alpha",
		Name:        "Alpha",
		ProjectDir:  customProjectDir,
		RelativeDir: customProjectDir,
		CreatedAt:   domain.TimeFromString("2026-06-02T00:00:00Z"),
		UpdatedAt:   domain.TimeFromString("2026-06-02T00:00:00Z"),
	}); err != nil {
		t.Fatalf("UpsertProject() error = %v", err)
	}
	store := NewMediaAssetsFromRepository(
		workspaceRepos.MediaAssets,
		globalDir,
		workspaceRoot,
		workspaceRepos.Workspace,
		nil,
	)

	asset, err := store.SaveBase64(
		MediaKindImage,
		"image/png",
		base64.StdEncoding.EncodeToString([]byte("image-bytes")),
		"",
		"alpha",
	)
	if err != nil {
		t.Fatalf("SaveBase64() error = %v", err)
	}

	wantDir := mediaAssetTestDateDir(asset, filepath.Join(customProjectDir, "library"))
	if got := filepath.Dir(asset.FilePath); got != wantDir {
		t.Fatalf("asset dir = %q, want %q", got, wantDir)
	}
}

func mediaAssetTestDateDir(asset MediaAsset, libraryDir string) string {
	return filepath.Join(libraryDir, mediaAssetDateDirFromTimestamp(asset.CreatedAt))
}

func mediaAssetTestRelativePath(asset MediaAsset) string {
	return filepath.ToSlash(filepath.Join("library", mediaAssetDateDirFromTimestamp(asset.CreatedAt), filepath.Base(asset.FilePath)))
}

func multipartFileHeader(t *testing.T, filename string, data []byte) *multipart.FileHeader {
	t.Helper()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile() error = %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("writing multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("closing multipart writer: %v", err)
	}

	request := httptest.NewRequest("POST", "/media/assets", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(MaxMediaAssetUploadSize); err != nil {
		t.Fatalf("ParseMultipartForm() error = %v", err)
	}
	files := request.MultipartForm.File["file"]
	if len(files) != 1 {
		t.Fatalf("multipart files = %d, want 1", len(files))
	}
	return files[0]
}

func fakeMediaToolsDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	writeExecutableFile(t, filepath.Join(dir, "ffprobe", "ffprobe"), `#!/bin/sh
cat <<'JSON'
{"format":{"duration":"6.250000"},"streams":[{"codec_type":"video","width":1920,"height":1080}]}
JSON
`)
	writeExecutableFile(t, filepath.Join(dir, "ffmpeg", "ffmpeg"), `#!/bin/sh
for last do :; done
printf poster > "$last"
`)
	return dir
}

func writeExecutableFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("creating tool dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("writing executable %s: %v", path, err)
	}
}
