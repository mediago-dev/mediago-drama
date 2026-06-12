package media

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/torchstellar-team/mediago-drama/packages/server/internal/config"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/domain"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/platform/timestamp"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/repository"
	"github.com/torchstellar-team/mediago-drama/packages/server/internal/service/shared"
)

const (
	mediaAssetListLimit     = 200
	MaxMediaAssetUploadSize = 200 << 20
	MediaKindImage          = shared.AssetKindImage
	MediaKindVideo          = shared.AssetKindVideo
	MetadataStatusReady     = "ready"
	MetadataStatusFailed    = "failed"
)

var mediaAssetHTTPClient = &http.Client{Timeout: 2 * time.Minute}

type MediaAssets struct {
	mu                       sync.RWMutex
	repo                     *repository.MediaAssetRepository
	dir                      string
	workspaceRoot            string
	ffmpegPath               string
	ffmpegBinDir             string
	metadataBackfillAttempts map[string]struct{}
	initErr                  error
}

type MediaAsset struct {
	ID                string  `json:"id"`
	Kind              string  `json:"kind"`
	Filename          string  `json:"filename"`
	MIMEType          string  `json:"mimeType"`
	SizeBytes         int64   `json:"sizeBytes"`
	URL               string  `json:"url"`
	SourceURL         string  `json:"sourceUrl,omitempty"`
	ProjectID         string  `json:"projectId,omitempty"`
	DurationSeconds   float64 `json:"durationSeconds,omitempty"`
	Width             int     `json:"width,omitempty"`
	Height            int     `json:"height,omitempty"`
	PosterURL         string  `json:"posterUrl,omitempty"`
	MetadataStatus    string  `json:"metadataStatus,omitempty"`
	MetadataError     string  `json:"metadataError,omitempty"`
	MetadataUpdatedAt string  `json:"metadataUpdatedAt,omitempty"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
	FilePath          string  `json:"-"`
	PosterPath        string  `json:"-"`
}

type MediaAssetsResponse struct {
	Assets []MediaAsset `json:"assets"`
}

type MediaAssetUpdateRequest struct {
	Filename string `json:"filename"`
}

type GeneratedAssetFileSaveRequest struct {
	Directory string `json:"directory"`
	Filename  string `json:"filename"`
	AssetID   string `json:"assetId,omitempty"`
	Kind      string `json:"kind"`
	MIMEType  string `json:"mimeType,omitempty"`
	SourceURL string `json:"sourceUrl,omitempty"`
}

type GeneratedAssetFileSaveResponse struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
}

type mediaAssetModel = domain.MediaAssetModel

func NewMediaAssets(dbPath string, mediaDir string) *MediaAssets {
	if dbPath == "" {
		dbPath = config.DefaultSettingsDBPath()
	}
	if mediaDir == "" {
		mediaDir = defaultMediaDir()
	}

	store := &MediaAssets{dir: mediaDir}
	if err := os.MkdirAll(mediaDir, 0o700); err != nil {
		store.initErr = fmt.Errorf("creating media asset directory: %w", err)
		return store
	}

	repos, err := repository.OpenSettingsRepositories(dbPath)
	if err != nil {
		store.initErr = err
		return store
	}

	store.repo = repos.MediaAssets
	return store
}

// NewMediaAssetsFromRepository returns a media asset service backed by an
// already constructed repository.
func NewMediaAssetsFromRepository(repo *repository.MediaAssetRepository, mediaDir string, workspaceRoot string, _ *repository.WorkspaceRepository, initErr error) *MediaAssets {
	if mediaDir == "" {
		mediaDir = defaultMediaDir()
	}

	store := &MediaAssets{
		repo:          repo,
		dir:           mediaDir,
		workspaceRoot: strings.TrimSpace(workspaceRoot),
		initErr:       initErr,
	}
	if store.initErr != nil {
		return store
	}
	if store.repo == nil {
		store.initErr = errors.New("media asset repository is nil")
		return store
	}
	if err := os.MkdirAll(mediaDir, 0o700); err != nil {
		store.initErr = fmt.Errorf("creating media asset directory: %w", err)
	}
	return store
}

// SetMediaToolPaths configures ffmpeg/ffprobe lookup paths for metadata extraction.
func (store *MediaAssets) SetMediaToolPaths(ffmpegPath string, ffmpegBinDir string) {
	if store == nil {
		return
	}
	store.ffmpegPath = strings.TrimSpace(ffmpegPath)
	store.ffmpegBinDir = strings.TrimSpace(ffmpegBinDir)
}

// WorkspaceRoot returns the global workspace root used for project-scoped media.
func (store *MediaAssets) WorkspaceRoot() string {
	if store == nil {
		return ""
	}
	return strings.TrimSpace(store.workspaceRoot)
}

// ServeFilePath returns a sanitized on-disk path for serving a media asset.
func (store *MediaAssets) ServeFilePath(asset MediaAsset) (string, error) {
	if store == nil {
		return "", errors.New("media asset store is nil")
	}
	filePath := strings.TrimSpace(asset.FilePath)
	if filePath == "" {
		return "", fmt.Errorf("media asset %s has no file path", asset.ID)
	}
	absolutePath, err := filepath.Abs(filePath)
	if err != nil {
		return "", fmt.Errorf("resolving media asset path: %w", err)
	}
	for _, root := range []string{store.dir, store.workspaceRoot} {
		ok, err := pathWithinRoot(absolutePath, root)
		if err != nil {
			return "", err
		}
		if ok {
			return absolutePath, nil
		}
	}
	return "", fmt.Errorf("media asset %s path is outside allowed roots", asset.ID)
}

// ServePosterFilePath returns a sanitized on-disk path for serving a media asset poster.
func (store *MediaAssets) ServePosterFilePath(asset MediaAsset) (string, error) {
	if store == nil {
		return "", errors.New("media asset store is nil")
	}
	posterPath := strings.TrimSpace(asset.PosterPath)
	if posterPath == "" {
		return "", fmt.Errorf("media asset %s has no poster path", asset.ID)
	}
	absolutePath, err := filepath.Abs(posterPath)
	if err != nil {
		return "", fmt.Errorf("resolving media asset poster path: %w", err)
	}
	for _, root := range []string{store.dir, store.workspaceRoot} {
		ok, err := pathWithinRoot(absolutePath, root)
		if err != nil {
			return "", err
		}
		if ok {
			return absolutePath, nil
		}
	}
	return "", fmt.Errorf("media asset %s poster path is outside allowed roots", asset.ID)
}

func pathWithinRoot(absolutePath string, root string) (bool, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return false, nil
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return false, fmt.Errorf("resolving media asset root: %w", err)
	}
	relative, err := filepath.Rel(absoluteRoot, absolutePath)
	if err != nil {
		return false, fmt.Errorf("checking media asset path containment: %w", err)
	}
	return relative == "." ||
		(!filepath.IsAbs(relative) &&
			relative != ".." &&
			!strings.HasPrefix(relative, ".."+string(filepath.Separator))), nil
}

func (store *MediaAssets) List(projectID string) ([]MediaAsset, error) {
	if store.initErr != nil {
		return nil, store.initErr
	}

	store.mu.RLock()
	models, err := store.repo.ListMediaAssets(mediaAssetListLimit, projectID)
	store.mu.RUnlock()
	if err != nil {
		return nil, err
	}

	assets := mediaAssetRecordsFromModels(models)
	return store.backfillListedVideoMetadata(assets)
}

func (store *MediaAssets) Get(id string) (MediaAsset, bool, error) {
	if store.initErr != nil {
		return MediaAsset{}, false, store.initErr
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	model, err := store.repo.GetMediaAsset(id)
	if repository.IsRecordNotFound(err) {
		return MediaAsset{}, false, nil
	}
	if err != nil {
		return MediaAsset{}, false, err
	}

	return mediaAssetRecordFromModel(model), true, nil
}

func (store *MediaAssets) FindBySourceURL(sourceURL string) (MediaAsset, bool, error) {
	if store.initErr != nil {
		return MediaAsset{}, false, store.initErr
	}
	if strings.TrimSpace(sourceURL) == "" {
		return MediaAsset{}, false, nil
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	model, err := store.repo.FindMediaAssetBySourceURL(sourceURL)
	if repository.IsRecordNotFound(err) {
		return MediaAsset{}, false, nil
	}
	if err != nil {
		return MediaAsset{}, false, err
	}

	return mediaAssetRecordFromModel(model), true, nil
}

func (store *MediaAssets) SaveMultipartFile(header *multipart.FileHeader, projectID string) (MediaAsset, error) {
	if store.initErr != nil {
		return MediaAsset{}, store.initErr
	}

	file, err := header.Open()
	if err != nil {
		return MediaAsset{}, err
	}
	defer file.Close()

	data, err := shared.ReadLimited(file, MaxMediaAssetUploadSize)
	if err != nil {
		return MediaAsset{}, err
	}

	return store.saveBytesForProject(data, header.Filename, header.Header.Get("Content-Type"), "", projectID)
}

func (store *MediaAssets) SaveReader(ctx context.Context, reader io.Reader, filename string, contentType string, sourceURL string) (MediaAsset, error) {
	_ = ctx
	data, err := shared.ReadLimited(reader, MaxMediaAssetUploadSize)
	if err != nil {
		return MediaAsset{}, err
	}

	return store.saveBytesForProject(data, filename, contentType, sourceURL, "")
}

func (store *MediaAssets) SaveBase64(kind string, mimeType string, value string, sourceURL string, projectID string) (MediaAsset, error) {
	return store.saveBase64ForScope(kind, mimeType, value, sourceURL, projectID, "", "")
}

// SaveBase64ForStudioSession stores a generated asset in a studio session directory.
func (store *MediaAssets) SaveBase64ForStudioSession(kind string, mimeType string, value string, sourceURL string, sessionID string) (MediaAsset, error) {
	return store.saveBase64ForScope(kind, mimeType, value, sourceURL, "", sessionID, "")
}

// SaveBase64ForStudioDir stores a generated asset in a caller-owned studio directory.
func (store *MediaAssets) SaveBase64ForStudioDir(kind string, mimeType string, value string, sourceURL string, studioDir string) (MediaAsset, error) {
	return store.saveBase64ForScope(kind, mimeType, value, sourceURL, "", "", studioDir)
}

func (store *MediaAssets) saveBase64ForScope(kind string, mimeType string, value string, sourceURL string, projectID string, studioSessionID string, studioDir string) (MediaAsset, error) {
	if store.initErr != nil {
		return MediaAsset{}, store.initErr
	}
	encoded := stripDataURI(value)
	if encoded == "" {
		return MediaAsset{}, fmt.Errorf("base64 asset is empty")
	}

	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		data, err = base64.RawStdEncoding.DecodeString(encoded)
	}
	if err != nil {
		return MediaAsset{}, fmt.Errorf("decoding base64 asset: %w", err)
	}
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	if kind == "" {
		kind = shared.KindFromMIMEType(mimeType)
	}

	return store.saveBytesWithKind(data, kind, defaultAssetFilename(kind, mimeType), mimeType, sourceURL, projectID, studioSessionID, studioDir)
}

func (store *MediaAssets) SaveRemoteAsset(ctx context.Context, kind string, remoteURL string, projectID string) (MediaAsset, error) {
	return store.saveRemoteAssetForScope(ctx, kind, remoteURL, projectID, "", "")
}

// SaveGeneratedAssetFile exports a generated image or video to a user-selected local directory.
func (store *MediaAssets) SaveGeneratedAssetFile(ctx context.Context, request GeneratedAssetFileSaveRequest) (GeneratedAssetFileSaveResponse, error) {
	if store.initErr != nil {
		return GeneratedAssetFileSaveResponse{}, store.initErr
	}

	directory := strings.TrimSpace(request.Directory)
	if directory == "" {
		return GeneratedAssetFileSaveResponse{}, fmt.Errorf("保存文件夹不能为空")
	}
	info, err := os.Stat(directory)
	if err != nil {
		return GeneratedAssetFileSaveResponse{}, fmt.Errorf("读取保存文件夹失败: %w", err)
	}
	if !info.IsDir() {
		return GeneratedAssetFileSaveResponse{}, fmt.Errorf("选择的保存位置不是有效文件夹")
	}

	kind := strings.ToLower(strings.TrimSpace(request.Kind))
	mimeType := shared.NormalizeMIMEType(request.MIMEType)
	sourceURL := strings.TrimSpace(request.SourceURL)
	sourcePath := ""
	assetID := strings.TrimSpace(request.AssetID)
	if assetID != "" {
		asset, ok, err := store.Get(assetID)
		if err != nil {
			return GeneratedAssetFileSaveResponse{}, err
		}
		if !ok {
			return GeneratedAssetFileSaveResponse{}, fmt.Errorf("media asset %q was not found", assetID)
		}

		sourcePath, err = store.ServeFilePath(asset)
		if err != nil {
			return GeneratedAssetFileSaveResponse{}, err
		}
		if kind == "" {
			kind = asset.Kind
		} else if kind != asset.Kind {
			return GeneratedAssetFileSaveResponse{}, fmt.Errorf("media asset %q is not a %s asset", assetID, kind)
		}
		if mimeType == "" || mimeType == "application/octet-stream" {
			mimeType = shared.NormalizeMIMEType(asset.MIMEType)
		}
		if strings.TrimSpace(request.Filename) == "" {
			request.Filename = asset.Filename
		}
	} else if sourceURL == "" {
		return GeneratedAssetFileSaveResponse{}, fmt.Errorf("生成结果没有可保存的素材 ID")
	}
	if kind != MediaKindImage && kind != MediaKindVideo {
		return GeneratedAssetFileSaveResponse{}, fmt.Errorf("only image and video assets are supported")
	}
	if mimeType == "" {
		mimeType = defaultAssetMIMEType(kind)
	}

	filename := generatedAssetExportFilename(request.Filename, sourceURL, mimeType, kind)
	path, finalFilename := uniqueGeneratedAssetExportPath(directory, filename)
	if sourcePath != "" {
		if err := copyGeneratedAssetFile(sourcePath, path); err != nil {
			_ = os.Remove(path)
			return GeneratedAssetFileSaveResponse{}, err
		}
	} else if err := downloadGeneratedAssetFile(ctx, sourceURL, path); err != nil {
		_ = os.Remove(path)
		return GeneratedAssetFileSaveResponse{}, err
	}

	return GeneratedAssetFileSaveResponse{Path: path, Filename: finalFilename}, nil
}

// SaveRemoteAssetForStudioSession downloads and stores a remote asset in a studio session directory.
func (store *MediaAssets) SaveRemoteAssetForStudioSession(ctx context.Context, kind string, remoteURL string, sessionID string) (MediaAsset, error) {
	return store.saveRemoteAssetForScope(ctx, kind, remoteURL, "", sessionID, "")
}

// SaveRemoteAssetForStudioDir downloads and stores a remote asset in a caller-owned studio directory.
func (store *MediaAssets) SaveRemoteAssetForStudioDir(ctx context.Context, kind string, remoteURL string, studioDir string) (MediaAsset, error) {
	return store.saveRemoteAssetForScope(ctx, kind, remoteURL, "", "", studioDir)
}

func (store *MediaAssets) saveRemoteAssetForScope(ctx context.Context, kind string, remoteURL string, projectID string, studioSessionID string, studioDir string) (MediaAsset, error) {
	if store.initErr != nil {
		return MediaAsset{}, store.initErr
	}
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return MediaAsset{}, fmt.Errorf("remote asset url is empty")
	}
	if strings.TrimSpace(studioSessionID) == "" && strings.TrimSpace(studioDir) == "" {
		if existing, ok, err := store.FindBySourceURL(remoteURL); err != nil {
			return MediaAsset{}, err
		} else if ok {
			return existing, nil
		}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return MediaAsset{}, err
	}
	response, err := mediaAssetHTTPClient.Do(request)
	if err != nil {
		return MediaAsset{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return MediaAsset{}, fmt.Errorf("downloading asset failed with status %d", response.StatusCode)
	}
	if response.ContentLength > MaxMediaAssetUploadSize {
		return MediaAsset{}, fmt.Errorf("asset is larger than %d bytes", MaxMediaAssetUploadSize)
	}

	data, err := shared.ReadLimited(response.Body, MaxMediaAssetUploadSize)
	if err != nil {
		return MediaAsset{}, err
	}

	mimeType := response.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	if kind == "" {
		kind = shared.KindFromMIMEType(mimeType)
	}

	filename := filenameFromURL(remoteURL)
	if filename == "" {
		filename = defaultAssetFilename(kind, mimeType)
	}

	return store.saveBytesWithKind(data, kind, filename, mimeType, remoteURL, projectID, studioSessionID, studioDir)
}

func copyGeneratedAssetFile(sourcePath string, destinationPath string) error {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return fmt.Errorf("读取生成结果文件失败: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("生成结果文件不是有效文件")
	}
	if info.Size() > MaxMediaAssetUploadSize {
		return fmt.Errorf("asset is larger than %d bytes", MaxMediaAssetUploadSize)
	}

	input, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("打开生成结果文件失败: %w", err)
	}
	defer input.Close()

	output, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("创建保存文件失败: %w", err)
	}
	defer output.Close()

	if _, err := io.Copy(output, input); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	return nil
}

func downloadGeneratedAssetFile(ctx context.Context, sourceURL string, destinationPath string) error {
	sourceURL = strings.TrimSpace(sourceURL)
	parsed, err := url.Parse(sourceURL)
	if err != nil {
		return fmt.Errorf("解析生成结果地址失败: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("unsupported generated asset url %q", sourceURL)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	response, err := mediaAssetHTTPClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("downloading asset failed with status %d", response.StatusCode)
	}
	if response.ContentLength > MaxMediaAssetUploadSize {
		return fmt.Errorf("asset is larger than %d bytes", MaxMediaAssetUploadSize)
	}

	output, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("创建保存文件失败: %w", err)
	}
	defer output.Close()

	written, err := io.Copy(output, io.LimitReader(response.Body, MaxMediaAssetUploadSize+1))
	if err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	if written > MaxMediaAssetUploadSize {
		return fmt.Errorf("asset is larger than %d bytes", MaxMediaAssetUploadSize)
	}
	return nil
}

func generatedAssetExportFilename(filename string, sourceURL string, mimeType string, kind string) string {
	filename = strings.Trim(strings.TrimSpace(shared.SafeFilename(filename)), ".")
	if filename == "" {
		filename = filenameFromURL(sourceURL)
	}
	if filename == "" {
		filename = defaultAssetFilename(kind, mimeType)
	}
	if filepath.Ext(filename) == "" {
		filename += generatedAssetExportExtension(mimeType, kind)
	}
	return filename
}

func defaultAssetMIMEType(kind string) string {
	if kind == MediaKindVideo {
		return "video/mp4"
	}
	return "image/png"
}

func generatedAssetExportExtension(mimeType string, kind string) string {
	extension := shared.ExtensionForMIMEType(mimeType)
	if extension != ".bin" {
		return extension
	}
	if kind == MediaKindVideo {
		return ".mp4"
	}
	return ".png"
}

func uniqueGeneratedAssetExportPath(directory string, filename string) (string, string) {
	path := filepath.Join(directory, filename)
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return path, filename
	}

	extension := filepath.Ext(filename)
	stem := strings.TrimSuffix(filename, extension)
	if stem == "" {
		stem = "generated-file"
	}
	for index := 2; index < 10_000; index++ {
		candidate := fmt.Sprintf("%s-%d%s", stem, index, extension)
		path = filepath.Join(directory, candidate)
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			return path, candidate
		}
	}

	candidate := fmt.Sprintf("%s-%d%s", stem, time.Now().UnixMilli(), extension)
	return filepath.Join(directory, candidate), candidate
}

func (store *MediaAssets) Base64Value(asset MediaAsset) (string, error) {
	if store.initErr != nil {
		return "", store.initErr
	}
	data, err := os.ReadFile(asset.FilePath)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(data), nil
}

func (store *MediaAssets) DataURIValue(asset MediaAsset) (string, error) {
	encoded, err := store.Base64Value(asset)
	if err != nil {
		return "", err
	}

	return "data:" + asset.MIMEType + ";base64," + encoded, nil
}

func (store *MediaAssets) saveBytes(data []byte, filename string, contentType string, sourceURL string) (MediaAsset, error) {
	return store.saveBytesForProject(data, filename, contentType, sourceURL, "")
}

func (store *MediaAssets) saveBytesForProject(data []byte, filename string, contentType string, sourceURL string, projectID string) (MediaAsset, error) {
	mimeType := strings.TrimSpace(strings.Split(contentType, ";")[0])
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(data)
	}
	kind := shared.KindFromMIMEType(mimeType)
	if kind == "" {
		return MediaAsset{}, fmt.Errorf("only image and video assets are supported")
	}

	return store.saveBytesWithKind(data, kind, filename, mimeType, sourceURL, projectID, "", "")
}

func (store *MediaAssets) saveBytesWithKind(data []byte, kind string, filename string, mimeType string, sourceURL string, projectID string, studioSessionID string, studioDir string) (MediaAsset, error) {
	if store.initErr != nil {
		return MediaAsset{}, store.initErr
	}
	if len(data) == 0 {
		return MediaAsset{}, fmt.Errorf("asset file is empty")
	}
	if len(data) > MaxMediaAssetUploadSize {
		return MediaAsset{}, fmt.Errorf("asset is larger than %d bytes", MaxMediaAssetUploadSize)
	}
	if kind != MediaKindImage && kind != MediaKindVideo {
		return MediaAsset{}, fmt.Errorf("only image and video assets are supported")
	}

	id, err := shared.RandomID("asset")
	if err != nil {
		return MediaAsset{}, err
	}

	filename = shared.SafeFilename(filename)
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = shared.ExtensionForMIMEType(mimeType)
	}
	if filename == "" {
		filename = id + ext
	}
	if filepath.Ext(filename) == "" {
		filename += ext
	}

	projectID = domain.CleanProjectID(projectID)
	studioSessionID = domain.CleanProjectID(studioSessionID)
	targetDir, err := store.targetDir(projectID, studioSessionID, studioDir)
	if err != nil {
		return MediaAsset{}, err
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return MediaAsset{}, fmt.Errorf("creating media asset directory: %w", err)
	}

	filePath := filepath.Join(targetDir, id+filepath.Ext(filename))
	if err := os.WriteFile(filePath, data, 0o600); err != nil {
		return MediaAsset{}, err
	}

	now := timestamp.NowRFC3339Nano()
	asset := MediaAsset{
		ID:             id,
		Kind:           kind,
		Filename:       filename,
		MIMEType:       mimeType,
		SizeBytes:      int64(len(data)),
		URL:            "/api/v1/media-assets/" + url.PathEscape(id) + "/content",
		SourceURL:      strings.TrimSpace(sourceURL),
		ProjectID:      projectID,
		MetadataStatus: "",
		CreatedAt:      now,
		UpdatedAt:      now,
		FilePath:       filePath,
	}
	if kind == MediaKindVideo {
		asset = store.enrichVideoMetadata(asset, now)
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.repo.CreateMediaAsset(mediaAssetModel{
		ID:                asset.ID,
		Kind:              asset.Kind,
		Filename:          asset.Filename,
		MIMEType:          asset.MIMEType,
		SizeBytes:         asset.SizeBytes,
		Path:              asset.FilePath,
		URL:               asset.URL,
		SourceURL:         asset.SourceURL,
		ProjectID:         asset.ProjectID,
		DurationSeconds:   asset.DurationSeconds,
		Width:             asset.Width,
		Height:            asset.Height,
		PosterPath:        asset.PosterPath,
		PosterURL:         asset.PosterURL,
		MetadataStatus:    asset.MetadataStatus,
		MetadataError:     asset.MetadataError,
		MetadataUpdatedAt: asset.MetadataUpdatedAt,
		CreatedAt:         asset.CreatedAt,
		UpdatedAt:         asset.UpdatedAt,
	}); err != nil {
		_ = os.Remove(filePath)
		if asset.PosterPath != "" {
			_ = os.Remove(asset.PosterPath)
		}
		return MediaAsset{}, err
	}

	return asset, nil
}

func (store *MediaAssets) targetDir(projectID string, studioSessionID string, studioDir string) (string, error) {
	projectID = domain.CleanProjectID(projectID)
	studioSessionID = domain.CleanProjectID(studioSessionID)
	studioDir = strings.TrimSpace(studioDir)
	if studioDir != "" {
		return filepath.Clean(studioDir), nil
	}
	if studioSessionID != "" {
		if strings.TrimSpace(store.workspaceRoot) == "" {
			return "", fmt.Errorf("workspace root is required for studio session media")
		}
		return shared.WorkspacePathsFor(store.workspaceRoot).StudioSessionDir(studioSessionID), nil
	}
	if projectID != "" {
		return store.dir, nil
	}
	return store.dir, nil
}

func (store *MediaAssets) Delete(id string) (bool, error) {
	if store.initErr != nil {
		return false, store.initErr
	}

	asset, ok, err := store.Get(id)
	if err != nil || !ok {
		return ok, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	deleted, err := store.repo.DeleteMediaAsset(id)
	if err != nil {
		return false, err
	}
	if deleted {
		_ = os.Remove(asset.FilePath)
		if asset.PosterPath != "" {
			_ = os.Remove(asset.PosterPath)
		}
	}

	return deleted, nil
}

func (store *MediaAssets) UpdateFilename(id string, filename string) (MediaAsset, bool, error) {
	if store.initErr != nil {
		return MediaAsset{}, false, store.initErr
	}
	filename = shared.SafeFilename(filename)
	if filename == "" {
		return MediaAsset{}, false, fmt.Errorf("filename is required")
	}

	asset, ok, err := store.Get(id)
	if err != nil {
		return MediaAsset{}, ok, err
	}
	if !ok {
		return MediaAsset{}, false, nil
	}
	if filepath.Ext(filename) == "" {
		filename += filepath.Ext(asset.Filename)
	}
	asset.Filename = filename
	asset.UpdatedAt = timestamp.NowRFC3339Nano()

	store.mu.Lock()
	defer store.mu.Unlock()
	if err := store.repo.UpdateMediaAssetFilename(asset.ID, asset.Filename, asset.UpdatedAt); err != nil {
		return MediaAsset{}, false, err
	}

	return asset, true, nil
}

func FilterMediaAssets(assets []MediaAsset, kind string, query string) []MediaAsset {
	kind = strings.ToLower(strings.TrimSpace(kind))
	query = strings.ToLower(strings.TrimSpace(query))
	if kind == "" && query == "" {
		return assets
	}

	filtered := make([]MediaAsset, 0, len(assets))
	for _, asset := range assets {
		if kind != "" && kind != "all" && strings.ToLower(asset.Kind) != kind {
			continue
		}
		if query != "" &&
			!strings.Contains(strings.ToLower(asset.Filename), query) &&
			!strings.Contains(strings.ToLower(asset.SourceURL), query) &&
			!strings.Contains(strings.ToLower(asset.MIMEType), query) {
			continue
		}
		filtered = append(filtered, asset)
	}

	return filtered
}

func mediaAssetRecordsFromModels(models []mediaAssetModel) []MediaAsset {
	assets := make([]MediaAsset, 0, len(models))
	for _, model := range models {
		assets = append(assets, mediaAssetRecordFromModel(model))
	}
	return assets
}

func (store *MediaAssets) backfillListedVideoMetadata(assets []MediaAsset) ([]MediaAsset, error) {
	for index := range assets {
		asset := assets[index]
		if !store.shouldAttemptVideoMetadataBackfill(asset) {
			continue
		}

		updated := store.enrichVideoMetadata(asset, timestamp.NowRFC3339Nano())
		store.mu.Lock()
		err := store.repo.UpdateMediaAssetMetadata(updated.ID, mediaAssetMetadataUpdates(updated))
		store.mu.Unlock()
		if err != nil {
			return nil, err
		}
		assets[index] = updated
	}
	return assets, nil
}

func (store *MediaAssets) shouldAttemptVideoMetadataBackfill(asset MediaAsset) bool {
	if !store.needsVideoMetadataBackfill(asset) {
		return false
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.metadataBackfillAttempts == nil {
		store.metadataBackfillAttempts = map[string]struct{}{}
	}
	if _, ok := store.metadataBackfillAttempts[asset.ID]; ok {
		return false
	}
	store.metadataBackfillAttempts[asset.ID] = struct{}{}
	return true
}

func (store *MediaAssets) needsVideoMetadataBackfill(asset MediaAsset) bool {
	if asset.Kind != MediaKindVideo || strings.TrimSpace(asset.FilePath) == "" {
		return false
	}
	if asset.DurationSeconds <= 0 || asset.Width <= 0 || asset.Height <= 0 {
		return true
	}
	if strings.TrimSpace(asset.MetadataStatus) != MetadataStatusReady {
		return true
	}
	if strings.TrimSpace(asset.PosterURL) == "" || strings.TrimSpace(asset.PosterPath) == "" {
		return true
	}
	posterPath, err := store.ServePosterFilePath(asset)
	if err != nil {
		return true
	}
	info, err := os.Stat(posterPath)
	return err != nil || info.Size() == 0
}

func mediaAssetMetadataUpdates(asset MediaAsset) map[string]any {
	return map[string]any{
		"duration_seconds":    asset.DurationSeconds,
		"width":               asset.Width,
		"height":              asset.Height,
		"poster_path":         asset.PosterPath,
		"poster_url":          asset.PosterURL,
		"metadata_status":     asset.MetadataStatus,
		"metadata_error":      asset.MetadataError,
		"metadata_updated_at": asset.MetadataUpdatedAt,
	}
}

func mediaAssetRecordFromModel(model mediaAssetModel) MediaAsset {
	return MediaAsset{
		ID:                model.ID,
		Kind:              model.Kind,
		Filename:          model.Filename,
		MIMEType:          model.MIMEType,
		SizeBytes:         model.SizeBytes,
		URL:               model.URL,
		SourceURL:         model.SourceURL,
		ProjectID:         model.ProjectID,
		DurationSeconds:   model.DurationSeconds,
		Width:             model.Width,
		Height:            model.Height,
		PosterURL:         model.PosterURL,
		MetadataStatus:    model.MetadataStatus,
		MetadataError:     model.MetadataError,
		MetadataUpdatedAt: model.MetadataUpdatedAt,
		CreatedAt:         model.CreatedAt,
		UpdatedAt:         model.UpdatedAt,
		FilePath:          model.Path,
		PosterPath:        model.PosterPath,
	}
}

func defaultMediaDir() string {
	return filepath.Join(shared.DefaultUserDataDir(), "assets")
}

func stripDataURI(value string) string {
	value = strings.TrimSpace(value)
	if _, encoded, ok := strings.Cut(value, ","); ok && strings.HasPrefix(strings.ToLower(value), "data:") {
		return strings.TrimSpace(encoded)
	}

	return value
}

func defaultAssetFilename(kind string, mimeType string) string {
	prefix := "asset"
	if kind == MediaKindImage {
		prefix = "image"
	}
	if kind == MediaKindVideo {
		prefix = "video"
	}

	return prefix + shared.ExtensionForMIMEType(mimeType)
}

func filenameFromURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}

	return shared.SafeFilename(filepath.Base(parsed.Path))
}
