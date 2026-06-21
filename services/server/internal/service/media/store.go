package media

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
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

	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/platform/timestamp"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

const (
	mediaAssetListLimit     = 200
	MaxMediaAssetUploadSize = 200 << 20
	MediaKindImage          = shared.AssetKindImage
	MediaKindVideo          = shared.AssetKindVideo
	MediaKindAudio          = shared.AssetKindAudio
	MediaKindText           = shared.AssetKindText
	MetadataStatusReady     = "ready"
	MetadataStatusFailed    = "failed"
	StorageStatusReady      = "ready"
	StorageStatusMissing    = "missing"
	MediaSourceUpload       = "upload"
	MediaSourceGeneration   = "generation"
	MediaSourceToolbox      = "toolbox"
	MediaSourcePreview      = "preview"
)

var mediaAssetHTTPClient = &http.Client{Timeout: 2 * time.Minute}

type MediaAssets struct {
	mu                       sync.RWMutex
	repo                     *repository.MediaAssetRepository
	workspaceRepo            *repository.WorkspaceRepository
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
	ContentHash       string  `json:"-"`
	ProjectID         string  `json:"projectId,omitempty"`
	Source            string  `json:"source,omitempty"`
	ConversationID    string  `json:"conversationId,omitempty"`
	SectionID         string  `json:"sectionId,omitempty"`
	RelativePath      string  `json:"relativePath,omitempty"`
	DurationSeconds   float64 `json:"durationSeconds,omitempty"`
	Width             int     `json:"width,omitempty"`
	Height            int     `json:"height,omitempty"`
	PosterURL         string  `json:"posterUrl,omitempty"`
	MetadataStatus    string  `json:"metadataStatus,omitempty"`
	MetadataError     string  `json:"metadataError,omitempty"`
	MetadataUpdatedAt string  `json:"metadataUpdatedAt,omitempty"`
	StorageStatus     string  `json:"storageStatus,omitempty"`
	StorageError      string  `json:"storageError,omitempty"`
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

// MediaAssetSaveOptions describes where a new media asset should live.
type MediaAssetSaveOptions struct {
	ProjectID      string
	Source         string
	ConversationID string
	SectionID      string
}

type mediaAssetModel = domain.AssetModel

func NewMediaAssets(dbPath string, mediaDir string) *MediaAssets {
	if dbPath == "" {
		dbPath = shared.WorkspacePathsFor("").DatabasePath()
	}
	if mediaDir == "" {
		mediaDir = defaultMediaDir()
	}

	store := &MediaAssets{dir: mediaDir}
	if err := os.MkdirAll(mediaDir, 0o700); err != nil {
		store.initErr = fmt.Errorf("creating media asset directory: %w", err)
		return store
	}

	repo, err := repository.NewMediaAssetRepository(dbPath)
	if err != nil {
		store.initErr = err
		return store
	}

	store.repo = repo
	return store
}

// NewMediaAssetsFromRepository returns a media asset service backed by an
// already constructed repository.
func NewMediaAssetsFromRepository(repo *repository.MediaAssetRepository, mediaDir string, workspaceRoot string, workspaceRepo *repository.WorkspaceRepository, initErr error) *MediaAssets {
	if mediaDir == "" {
		if strings.TrimSpace(workspaceRoot) != "" {
			mediaDir = shared.WorkspacePathsFor(workspaceRoot).LibraryAssetsDir()
		} else {
			mediaDir = defaultMediaDir()
		}
	}

	store := &MediaAssets{
		repo:          repo,
		workspaceRepo: workspaceRepo,
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
	for _, root := range store.allowedRootsForAsset(asset) {
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
	for _, root := range store.allowedRootsForAsset(asset) {
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

	assets := store.mediaAssetRecordsFromModels(models)
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

	return store.mediaAssetRecordFromModel(model), true, nil
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

	return store.mediaAssetRecordFromModel(model), true, nil
}

func (store *MediaAssets) FindBySourceURLAndScope(sourceURL string, options MediaAssetSaveOptions) (MediaAsset, bool, error) {
	if store.initErr != nil {
		return MediaAsset{}, false, store.initErr
	}
	if strings.TrimSpace(sourceURL) == "" {
		return MediaAsset{}, false, nil
	}
	options = normalizeMediaAssetSaveOptions(options)

	store.mu.RLock()
	defer store.mu.RUnlock()

	model, err := store.repo.FindMediaAssetBySourceURLAndScope(
		sourceURL,
		options.ProjectID,
		options.Source,
		options.ConversationID,
	)
	if repository.IsRecordNotFound(err) {
		return MediaAsset{}, false, nil
	}
	if err != nil {
		return MediaAsset{}, false, err
	}

	return store.mediaAssetRecordFromModel(model), true, nil
}

func (store *MediaAssets) FindByContentHashAndScope(contentHash string, kind string, options MediaAssetSaveOptions) (MediaAsset, bool, error) {
	if store.initErr != nil {
		return MediaAsset{}, false, store.initErr
	}
	contentHash = strings.TrimSpace(contentHash)
	if contentHash == "" {
		return MediaAsset{}, false, nil
	}
	options = normalizeMediaAssetSaveOptions(options)

	store.mu.RLock()
	defer store.mu.RUnlock()

	model, err := store.repo.FindMediaAssetByContentHashAndScope(
		contentHash,
		kind,
		options.ProjectID,
		options.Source,
		options.ConversationID,
	)
	if repository.IsRecordNotFound(err) {
		return MediaAsset{}, false, nil
	}
	if err != nil {
		return MediaAsset{}, false, err
	}

	asset := store.mediaAssetRecordFromModel(model)
	if _, err := store.ServeFilePath(asset); err != nil {
		return MediaAsset{}, false, nil
	}
	if _, err := os.Stat(asset.FilePath); err != nil {
		return MediaAsset{}, false, nil
	}
	return asset, true, nil
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

	return store.saveBytesForProject(data, header.Filename, header.Header.Get("Content-Type"), "", projectID, MediaSourceUpload)
}

func (store *MediaAssets) SaveReader(ctx context.Context, reader io.Reader, filename string, contentType string, sourceURL string) (MediaAsset, error) {
	_ = ctx
	data, err := shared.ReadLimited(reader, MaxMediaAssetUploadSize)
	if err != nil {
		return MediaAsset{}, err
	}

	return store.saveBytesForProject(data, filename, contentType, sourceURL, "", MediaSourceUpload)
}

func (store *MediaAssets) SaveBase64(kind string, mimeType string, value string, sourceURL string, projectID string) (MediaAsset, error) {
	return store.SaveBase64WithOptions(kind, mimeType, value, sourceURL, MediaAssetSaveOptions{
		ProjectID: projectID,
		Source:    MediaSourceGeneration,
	})
}

// SaveBase64WithOptions stores a base64 media asset using explicit placement metadata.
func (store *MediaAssets) SaveBase64WithOptions(kind string, mimeType string, value string, sourceURL string, options MediaAssetSaveOptions) (MediaAsset, error) {
	return store.saveBase64WithOptions(kind, mimeType, value, sourceURL, options)
}

// SaveTextWithOptions stores a text asset using explicit placement metadata.
func (store *MediaAssets) SaveTextWithOptions(content string, filename string, sourceURL string, options MediaAssetSaveOptions) (MediaAsset, error) {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		filename = defaultAssetFilename(MediaKindText, "text/plain")
	}
	return store.saveBytesWithKind([]byte(content), MediaKindText, filename, "text/plain", sourceURL, options)
}

// SaveBase64ForStudioSession is a legacy wrapper for toolbox conversation assets.
func (store *MediaAssets) SaveBase64ForStudioSession(kind string, mimeType string, value string, sourceURL string, sessionID string) (MediaAsset, error) {
	return store.SaveBase64WithOptions(kind, mimeType, value, sourceURL, MediaAssetSaveOptions{
		Source:         MediaSourceToolbox,
		ConversationID: sessionID,
	})
}

// SaveBase64ForStudioDir is a legacy wrapper for toolbox conversation assets.
func (store *MediaAssets) SaveBase64ForStudioDir(kind string, mimeType string, value string, sourceURL string, studioDir string) (MediaAsset, error) {
	return store.SaveBase64WithOptions(kind, mimeType, value, sourceURL, MediaAssetSaveOptions{
		Source:         MediaSourceToolbox,
		ConversationID: filepath.Base(strings.TrimSpace(studioDir)),
	})
}

func (store *MediaAssets) saveBase64WithOptions(kind string, mimeType string, value string, sourceURL string, options MediaAssetSaveOptions) (MediaAsset, error) {
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

	return store.saveBytesWithKind(data, kind, defaultAssetFilename(kind, mimeType), mimeType, sourceURL, options)
}

func (store *MediaAssets) SaveRemoteAsset(ctx context.Context, kind string, remoteURL string, projectID string) (MediaAsset, error) {
	return store.SaveRemoteAssetWithOptions(ctx, kind, remoteURL, MediaAssetSaveOptions{
		ProjectID: projectID,
		Source:    MediaSourceGeneration,
	})
}

// SaveRemoteAssetWithOptions downloads and stores a remote media asset using explicit placement metadata.
func (store *MediaAssets) SaveRemoteAssetWithOptions(ctx context.Context, kind string, remoteURL string, options MediaAssetSaveOptions) (MediaAsset, error) {
	return store.saveRemoteAssetWithOptions(ctx, kind, remoteURL, options)
}

// SaveGeneratedAssetFile exports a generated media asset to a user-selected local directory.
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
	if !isSupportedMediaAssetKind(kind) {
		return GeneratedAssetFileSaveResponse{}, unsupportedMediaAssetKindError()
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

// SaveRemoteAssetForStudioSession is a legacy wrapper for toolbox conversation assets.
func (store *MediaAssets) SaveRemoteAssetForStudioSession(ctx context.Context, kind string, remoteURL string, sessionID string) (MediaAsset, error) {
	return store.SaveRemoteAssetWithOptions(ctx, kind, remoteURL, MediaAssetSaveOptions{
		Source:         MediaSourceToolbox,
		ConversationID: sessionID,
	})
}

// SaveRemoteAssetForStudioDir is a legacy wrapper for toolbox conversation assets.
func (store *MediaAssets) SaveRemoteAssetForStudioDir(ctx context.Context, kind string, remoteURL string, studioDir string) (MediaAsset, error) {
	return store.SaveRemoteAssetWithOptions(ctx, kind, remoteURL, MediaAssetSaveOptions{
		Source:         MediaSourceToolbox,
		ConversationID: filepath.Base(strings.TrimSpace(studioDir)),
	})
}

func (store *MediaAssets) saveRemoteAssetWithOptions(ctx context.Context, kind string, remoteURL string, options MediaAssetSaveOptions) (MediaAsset, error) {
	if store.initErr != nil {
		return MediaAsset{}, store.initErr
	}
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return MediaAsset{}, fmt.Errorf("remote asset url is empty")
	}
	options = normalizeMediaAssetSaveOptions(options)
	if existing, ok, err := store.FindBySourceURLAndScope(remoteURL, options); err != nil {
		return MediaAsset{}, err
	} else if ok {
		return existing, nil
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

	return store.saveBytesWithKind(data, kind, filename, mimeType, remoteURL, options)
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
	if kind == MediaKindAudio {
		return "audio/mpeg"
	}
	if kind == MediaKindText {
		return "text/plain"
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
	if kind == MediaKindAudio {
		return ".mp3"
	}
	if kind == MediaKindText {
		return ".txt"
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
	return store.saveBytesForProject(data, filename, contentType, sourceURL, "", MediaSourceUpload)
}

func (store *MediaAssets) saveBytesForProject(data []byte, filename string, contentType string, sourceURL string, projectID string, source string) (MediaAsset, error) {
	mimeType := strings.TrimSpace(strings.Split(contentType, ";")[0])
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(data)
	}
	kind := shared.KindFromMIMEType(mimeType)
	if !isSupportedMediaAssetKind(kind) {
		return MediaAsset{}, unsupportedMediaAssetKindError()
	}

	return store.saveBytesWithKind(data, kind, filename, mimeType, sourceURL, MediaAssetSaveOptions{
		ProjectID: projectID,
		Source:    source,
	})
}

func (store *MediaAssets) saveBytesWithKind(data []byte, kind string, filename string, mimeType string, sourceURL string, options MediaAssetSaveOptions) (MediaAsset, error) {
	if store.initErr != nil {
		return MediaAsset{}, store.initErr
	}
	kind = strings.ToLower(strings.TrimSpace(kind))
	mimeType = shared.NormalizeMIMEType(mimeType)
	if mimeType == "" {
		mimeType = defaultAssetMIMEType(kind)
	}
	if len(data) == 0 {
		return MediaAsset{}, fmt.Errorf("asset file is empty")
	}
	if len(data) > MaxMediaAssetUploadSize {
		return MediaAsset{}, fmt.Errorf("asset is larger than %d bytes", MaxMediaAssetUploadSize)
	}
	if !isSupportedMediaAssetKind(kind) {
		return MediaAsset{}, unsupportedMediaAssetKindError()
	}

	nowTime := time.Now()
	now := timestamp.FormatRFC3339Nano(nowTime)
	options = normalizeMediaAssetSaveOptions(options)
	contentHash := mediaAssetContentHash(data)
	if shouldReuseMediaAssetContent(options.Source) {
		if existing, ok, err := store.FindByContentHashAndScope(contentHash, kind, options); err != nil {
			return MediaAsset{}, err
		} else if ok {
			return existing, nil
		}
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

	target, err := store.targetLocation(options, mediaAssetDateDirForTime(nowTime))
	if err != nil {
		return MediaAsset{}, err
	}
	if err := os.MkdirAll(target.Directory, 0o755); err != nil {
		return MediaAsset{}, fmt.Errorf("creating media asset directory: %w", err)
	}

	filePath := filepath.Join(target.Directory, id+filepath.Ext(filename))
	if err := os.WriteFile(filePath, data, 0o600); err != nil {
		return MediaAsset{}, err
	}
	relativePath := joinAssetRelativePath(target.RelativeDir, filepath.Base(filePath))

	asset := MediaAsset{
		ID:             id,
		Kind:           kind,
		Filename:       filename,
		MIMEType:       mimeType,
		SizeBytes:      int64(len(data)),
		URL:            "/api/v1/media-assets/" + url.PathEscape(id) + "/content",
		SourceURL:      strings.TrimSpace(sourceURL),
		ContentHash:    contentHash,
		ProjectID:      options.ProjectID,
		Source:         options.Source,
		ConversationID: options.ConversationID,
		SectionID:      options.SectionID,
		RelativePath:   relativePath,
		MetadataStatus: "",
		StorageStatus:  StorageStatusReady,
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
		ID:              asset.ID,
		Kind:            asset.Kind,
		Filename:        asset.Filename,
		MIMEType:        asset.MIMEType,
		SizeBytes:       asset.SizeBytes,
		RelPath:         asset.RelativePath,
		URL:             asset.URL,
		SourceURL:       asset.SourceURL,
		ContentHash:     asset.ContentHash,
		ProjectID:       domain.StringPtr(asset.ProjectID),
		Source:          asset.Source,
		DurationSeconds: asset.DurationSeconds,
		Width:           asset.Width,
		Height:          asset.Height,
		PosterRelPath:   store.mediaAssetDBRelPath(asset.ProjectID, asset.PosterPath),
		PosterURL:       asset.PosterURL,
		MetadataStatus:  asset.MetadataStatus,
		StorageStatus:   asset.StorageStatus,
		CreatedAt:       domain.TimeFromString(asset.CreatedAt),
		UpdatedAt:       domain.TimeFromString(asset.UpdatedAt),
	}); err != nil {
		_ = os.Remove(filePath)
		if asset.PosterPath != "" {
			_ = os.Remove(asset.PosterPath)
		}
		return MediaAsset{}, err
	}

	return asset, nil
}

func isSupportedMediaAssetKind(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case MediaKindImage, MediaKindVideo, MediaKindAudio, MediaKindText:
		return true
	default:
		return false
	}
}

func shouldReuseMediaAssetContent(source string) bool {
	switch normalizeMediaAssetSource(source) {
	case MediaSourceGeneration, MediaSourceToolbox, MediaSourcePreview:
		return true
	default:
		return false
	}
}

func mediaAssetContentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func unsupportedMediaAssetKindError() error {
	return fmt.Errorf("only image, video, audio, and text assets are supported")
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
			!strings.Contains(strings.ToLower(asset.RelativePath), query) &&
			!strings.Contains(strings.ToLower(asset.MIMEType), query) {
			continue
		}
		filtered = append(filtered, asset)
	}

	return filtered
}

func (store *MediaAssets) backfillListedVideoMetadata(assets []MediaAsset) ([]MediaAsset, error) {
	for index := range assets {
		asset := assets[index]
		if !store.shouldAttemptVideoMetadataBackfill(asset) {
			continue
		}

		updated := store.enrichVideoMetadata(asset, timestamp.NowRFC3339Nano())
		store.mu.Lock()
		err := store.repo.UpdateMediaAssetMetadata(updated.ID, store.mediaAssetMetadataUpdates(updated))
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
	if expectedPosterPath, err := store.expectedVideoPosterPath(asset); err != nil || !sameMediaAssetPath(asset.PosterPath, expectedPosterPath) {
		return true
	}
	posterPath, err := store.ServePosterFilePath(asset)
	if err != nil {
		return true
	}
	info, err := os.Stat(posterPath)
	return err != nil || info.Size() == 0
}

func (store *MediaAssets) mediaAssetMetadataUpdates(asset MediaAsset) map[string]any {
	return map[string]any{
		"duration_seconds": asset.DurationSeconds,
		"width":            asset.Width,
		"height":           asset.Height,
		"poster_rel_path":  store.mediaAssetDBRelPath(asset.ProjectID, asset.PosterPath),
		"poster_url":       asset.PosterURL,
		"metadata_status":  asset.MetadataStatus,
	}
}

func (store *MediaAssets) mediaAssetRecordsFromModels(models []mediaAssetModel) []MediaAsset {
	assets := make([]MediaAsset, 0, len(models))
	for _, model := range models {
		assets = append(assets, store.mediaAssetRecordFromModel(model))
	}
	return assets
}

func (store *MediaAssets) mediaAssetRecordFromModel(model mediaAssetModel) MediaAsset {
	return MediaAsset{
		ID:              model.ID,
		Kind:            model.Kind,
		Filename:        model.Filename,
		MIMEType:        model.MIMEType,
		SizeBytes:       model.SizeBytes,
		URL:             model.URL,
		SourceURL:       model.SourceURL,
		ContentHash:     model.ContentHash,
		ProjectID:       domain.StringValue(model.ProjectID),
		Source:          model.Source,
		RelativePath:    model.RelPath,
		DurationSeconds: model.DurationSeconds,
		Width:           model.Width,
		Height:          model.Height,
		PosterURL:       model.PosterURL,
		MetadataStatus:  model.MetadataStatus,
		StorageStatus:   model.StorageStatus,
		CreatedAt:       domain.StringFromTime(model.CreatedAt),
		UpdatedAt:       domain.StringFromTime(model.UpdatedAt),
		FilePath:        store.assetFilePath(domain.StringValue(model.ProjectID), model.RelPath),
		PosterPath:      store.assetFilePath(domain.StringValue(model.ProjectID), model.PosterRelPath),
	}
}

func (store *MediaAssets) assetFilePath(projectID string, relPath string) string {
	relPath = strings.TrimSpace(relPath)
	if relPath == "" || filepath.IsAbs(relPath) {
		return relPath
	}
	projectID = domain.CleanProjectID(projectID)
	if projectID != "" {
		if projectDir, err := store.projectDir(projectID); err == nil && projectDir != "" {
			return filepath.Join(projectDir, filepath.FromSlash(relPath))
		}
	}
	baseDir := strings.TrimSpace(store.dir)
	if baseDir == "" && strings.TrimSpace(store.workspaceRoot) != "" {
		baseDir = shared.WorkspacePathsFor(store.workspaceRoot).LibraryAssetsDir()
	}
	if strings.HasPrefix(filepath.ToSlash(relPath), ".mediago-drama/") && strings.TrimSpace(store.workspaceRoot) != "" {
		return filepath.Join(store.workspaceRoot, filepath.FromSlash(relPath))
	}
	if baseDir == "" {
		baseDir = defaultMediaDir()
	}
	rel := strings.TrimPrefix(filepath.ToSlash(relPath), "library/")
	return filepath.Join(baseDir, filepath.FromSlash(rel))
}

func (store *MediaAssets) mediaAssetDBRelPath(projectID string, filePath string) string {
	filePath = strings.TrimSpace(filePath)
	if filePath == "" || !filepath.IsAbs(filePath) {
		return filepath.ToSlash(filePath)
	}
	projectID = domain.CleanProjectID(projectID)
	if projectID != "" {
		if projectDir, err := store.projectDir(projectID); err == nil && projectDir != "" {
			if rel, ok := relativePathUnder(projectDir, filePath); ok {
				return rel
			}
		}
	}
	if strings.TrimSpace(store.workspaceRoot) != "" {
		if rel, ok := relativePathUnder(store.workspaceRoot, filePath); ok {
			return rel
		}
	}
	if strings.TrimSpace(store.dir) != "" {
		if rel, ok := relativePathUnder(store.dir, filePath); ok {
			return rel
		}
	}
	return filePath
}

func relativePathUnder(root string, path string) (string, bool) {
	root = strings.TrimSpace(root)
	path = strings.TrimSpace(path)
	if root == "" || path == "" {
		return "", false
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." || filepath.IsAbs(rel) {
		return "", false
	}
	return filepath.ToSlash(rel), true
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
	if kind == MediaKindAudio {
		prefix = "audio"
	}
	if kind == MediaKindText {
		prefix = "text"
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
