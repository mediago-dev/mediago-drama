// Package libtv adapts the locally bundled LibTV CLI to generation.
package libtv

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	defaultBinaryName       = "libtv"
	defaultDownloadTempDir  = "mediago-libtv-result-*"
	defaultReferenceTempDir = "mediago-libtv-ref-*"
	defaultNodeNameTemplate = "mediago-%s-%d"
	libTVProjectConfigPath  = ".libtv/project.json"
	defaultAutoProjectKey   = "__default__"
	referenceByteLimit      = 200 << 20
)

var (
	defaultUploadRetryDelays = []time.Duration{500 * time.Millisecond, 1500 * time.Millisecond}
	projectUUIDPattern       = regexp.MustCompile(`(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})`)
)

// CommandRunner executes one CLI command and returns combined output.
type CommandRunner interface {
	Run(ctx context.Context, path string, args ...string) ([]byte, error)
}

// CommandRunnerFunc adapts a function into a CommandRunner.
type CommandRunnerFunc func(ctx context.Context, path string, args ...string) ([]byte, error)

// Run executes the configured function.
func (fn CommandRunnerFunc) Run(ctx context.Context, path string, args ...string) ([]byte, error) {
	return fn(ctx, path, args...)
}

// ProjectBinding stores a LibTV project mapped to one MediaGo project.
type ProjectBinding struct {
	InternalProjectID   string `json:"internalProjectId"`
	InternalProjectName string `json:"internalProjectName,omitempty"`
	ProjectID           string `json:"projectId"`
	ProjectName         string `json:"projectName,omitempty"`
	CreatedAt           string `json:"createdAt,omitempty"`
	UpdatedAt           string `json:"updatedAt,omitempty"`
}

// ProjectStore persists LibTV project bindings.
type ProjectStore interface {
	GetLibTVProjectBinding(ctx context.Context, internalProjectID string) (ProjectBinding, bool, error)
	SaveLibTVProjectBinding(ctx context.Context, binding ProjectBinding) error
}

type imageModelSpec struct {
	Key         string
	CatalogName string
}

type modelSearchResponse struct {
	Matches []struct {
		ModelKey  string `json:"modelKey"`
		ModelName string `json:"modelName"`
	} `json:"matches"`
}

var imageModelsByRoute = map[string]imageModelSpec{
	generation.RouteLibTVGPTImage2: {
		Key:         "lib-image-2",
		CatalogName: "Lib Image",
	},
	generation.RouteLibTVNanoBanana31: {
		Key:         "nebula-2-flash",
		CatalogName: "Lib Navo 2",
	},
	generation.RouteLibTVSeedream5Lite: {
		Key:         "seedream-5",
		CatalogName: "Seedream 5.0 Lite",
	},
}

// Config controls the LibTV CLI provider.
type Config struct {
	BinPath           string
	BinDir            string
	ProjectID         string
	ProjectStore      ProjectStore
	Runner            CommandRunner
	Now               func() time.Time
	UploadRetryDelays []time.Duration
}

// Provider calls the local LibTV CLI.
type Provider struct {
	binPath           string
	projectID         string
	projectStore      ProjectStore
	runner            CommandRunner
	now               func() time.Time
	uploadRetryDelays []time.Duration
	projectMu         sync.Mutex
	autoProjectIDs    map[string]string
}

// NewProvider creates a LibTV CLI generation provider.
func NewProvider(config Config) (*Provider, error) {
	path, err := ResolveBinaryPath(config.BinPath, config.BinDir)
	if err != nil {
		return nil, err
	}
	runner := config.Runner
	if runner == nil {
		runner = execCommandRunner{}
	}
	now := config.Now
	if now == nil {
		now = time.Now
	}
	uploadRetryDelays := config.UploadRetryDelays
	if uploadRetryDelays == nil {
		uploadRetryDelays = defaultUploadRetryDelays
	}
	return &Provider{
		binPath:           path,
		projectID:         strings.TrimSpace(config.ProjectID),
		projectStore:      config.ProjectStore,
		runner:            runner,
		now:               now,
		uploadRetryDelays: append([]time.Duration(nil), uploadRetryDelays...),
		autoProjectIDs:    map[string]string{},
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return "libtv-cli"
}

func (provider *Provider) resolveImageModelName(ctx context.Context, routeID string) (string, error) {
	spec, ok := imageModelsByRoute[strings.TrimSpace(routeID)]
	if !ok {
		return "", fmt.Errorf("libtv image route %q is not configured", routeID)
	}

	output, err := provider.runner.Run(ctx, provider.binPath, "model", "search", "--type=image")
	if err != nil {
		return "", fmt.Errorf("resolving libtv image model %s: %w", spec.Key, commandError("model search", output, err))
	}
	payload, err := extractJSONObject(output)
	if err != nil {
		return "", fmt.Errorf("parsing LibTV model search JSON for %s: %w", spec.Key, err)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encoding LibTV model search JSON for %s: %w", spec.Key, err)
	}
	var search modelSearchResponse
	if err := json.Unmarshal(encoded, &search); err != nil {
		return "", fmt.Errorf("decoding LibTV model search JSON for %s: %w", spec.Key, err)
	}
	for _, match := range search.Matches {
		if match.ModelKey != spec.Key {
			continue
		}
		modelName := strings.TrimSpace(match.ModelName)
		if modelName == "" {
			return "", fmt.Errorf("LibTV image model %s returned an empty modelName", spec.Key)
		}
		return modelName, nil
	}

	return "", fmt.Errorf("当前 LibTV CLI/账号未提供模型 %s（%s）", spec.Key, spec.CatalogName)
}

// Generate submits a LibTV canvas node and triggers one generation run.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}
	route, ok, err := generation.ResolveRequestRouteForProvider(request, generation.ProviderLibTV)
	if err != nil {
		return generation.Response{}, err
	}
	if ok {
		if err := generation.ValidateRequestForRoute(request, route); err != nil {
			return generation.Response{}, err
		}
		request = generation.ApplyRoute(request, route)
	}
	switch request.Kind {
	case generation.KindImage, generation.KindVideo:
	default:
		return generation.Response{}, fmt.Errorf("libtv CLI does not support %s generation routes", request.Kind)
	}

	references, cleanup, err := materializeReferences(ctx, request.ReferenceURLs)
	if err != nil {
		return generation.Response{}, err
	}
	defer cleanup()
	if request.Kind == generation.KindImage {
		if err := validateImageReferences(references.media()); err != nil {
			return generation.Response{}, err
		}
		if err := validateImageParams(request.RouteID, request.Params); err != nil {
			return generation.Response{}, err
		}
		modelName, err := provider.resolveImageModelName(ctx, request.RouteID)
		if err != nil {
			return generation.Response{}, err
		}
		request.Model = modelName
	}

	projectID, err := provider.ensureProjectID(ctx, request)
	if err != nil {
		return generation.Response{}, err
	}

	referenceNodes, err := provider.uploadReferences(ctx, projectID, references.media())
	if err != nil {
		return generation.Response{}, err
	}

	nodeName := provider.nodeName(request.Kind)
	args := []string{"node"}
	if projectID != "" {
		args = append(args, "--project="+projectID)
	}
	args = append(args,
		"create",
		nodeName,
		"--type="+string(request.Kind),
		"--prompt="+request.Prompt,
	)
	appendSetFlag(&args, "model", request.Model)
	if request.Kind == generation.KindImage {
		appendImageNodeParams(&args, request, len(referenceNodes) > 0)
	} else {
		appendVideoNodeParams(&args, request.Params, len(referenceNodes) > 0)
	}
	for _, referenceNode := range referenceNodes {
		args = append(args, "--left-add="+referenceNode.Node)
	}
	args = append(args, "--run")

	output, err := provider.runner.Run(ctx, provider.binPath, args...)
	if err != nil {
		return generation.Response{}, commandError("node create", output, err)
	}

	payload, _ := extractJSONObject(output)
	taskNode := firstNonEmpty(stringFromMap(payload, "id"), stringFromMap(payload, "nodeId"), stringFromMap(payload, "node_id"), nodeName)
	return generation.Response{
		ID:     joinProviderTaskID(taskIDPrefix(request), projectID, taskNode),
		Status: "submitted",
		Model:  request.Model,
		Metadata: map[string]any{
			"result":     payload,
			"project_id": projectID,
			"node":       taskNode,
			"node_name":  nodeName,
			"references": referenceNodeMetadata(referenceNodes),
		},
	}, nil
}

// Get downloads the generated LibTV node output when it is ready.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	prefix, projectID, node := splitProviderTaskID(id)
	if strings.TrimSpace(node) == "" {
		return generation.Response{}, fmt.Errorf("libtv generation id must include a node id or node name")
	}
	if projectID == "" {
		projectID = provider.projectIDForRequest(generation.Request{})
	}
	if projectID == "" {
		projectID = boundLibTVProjectID()
	}
	if projectID == "" {
		projectID = provider.cachedAutoProjectID(defaultAutoProjectKey)
	}

	downloadDir, err := os.MkdirTemp("", defaultDownloadTempDir)
	if err != nil {
		return generation.Response{}, fmt.Errorf("creating libtv download temp dir: %w", err)
	}
	defer os.RemoveAll(downloadDir)

	args := []string{"download", "--node=" + node, "--out=" + downloadDir, "--without-ai-watermark", "--vip"}
	if strings.TrimSpace(projectID) != "" {
		args = append(args, "--project="+projectID)
	}
	output, err := provider.runner.Run(ctx, provider.binPath, args...)
	if err != nil {
		if isPendingDownloadOutput(output) {
			return generation.Response{
				ID:     joinProviderTaskID(prefix, projectID, node),
				Status: "submitted",
				Model:  "",
				Metadata: map[string]any{
					"output":     strings.TrimSpace(string(output)),
					"project_id": projectID,
					"node":       node,
				},
			}, nil
		}
		return generation.Response{}, commandError("download", output, err)
	}

	assets, err := assetsFromDownloadDir(downloadDir)
	if err != nil {
		return generation.Response{}, err
	}
	if len(assets) == 0 {
		return generation.Response{
			ID:     joinProviderTaskID(prefix, projectID, node),
			Status: "submitted",
			Metadata: map[string]any{
				"output":     strings.TrimSpace(string(output)),
				"project_id": projectID,
				"node":       node,
			},
		}, nil
	}
	return generation.Response{
		ID:     joinProviderTaskID(prefix, projectID, node),
		Status: "completed",
		Assets: assets,
		Metadata: map[string]any{
			"output":     strings.TrimSpace(string(output)),
			"project_id": projectID,
			"node":       node,
		},
	}, nil
}

func (provider *Provider) nodeName(kind generation.Kind) string {
	return fmt.Sprintf(defaultNodeNameTemplate, kind, provider.now().UnixNano())
}

func (provider *Provider) projectIDForRequest(request generation.Request) string {
	return firstNonEmpty(
		provider.projectID,
		paramString(request.Params, "projectId"),
		paramString(request.Params, "project_id"),
		paramString(request.Params, "project"),
	)
}

func (provider *Provider) ensureProjectID(ctx context.Context, request generation.Request) (string, error) {
	if projectID := provider.projectIDForRequest(request); projectID != "" {
		return projectID, nil
	}
	if projectID := provider.cachedAutoProjectID(autoProjectCacheKey(request)); projectID != "" {
		return projectID, nil
	}
	if strings.TrimSpace(request.ProjectID) != "" {
		return provider.createAutoProject(ctx, request)
	}
	if projectID := boundLibTVProjectID(); projectID != "" {
		return projectID, nil
	}
	return provider.createAutoProject(ctx, request)
}

func (provider *Provider) cachedAutoProjectID(key string) string {
	provider.projectMu.Lock()
	defer provider.projectMu.Unlock()
	return provider.autoProjectIDs[firstNonEmpty(key, defaultAutoProjectKey)]
}

func (provider *Provider) createAutoProject(ctx context.Context, request generation.Request) (string, error) {
	provider.projectMu.Lock()
	defer provider.projectMu.Unlock()

	cacheKey := autoProjectCacheKey(request)
	internalProjectID := strings.TrimSpace(request.ProjectID)
	if projectID := provider.autoProjectIDs[cacheKey]; projectID != "" {
		return projectID, nil
	}
	if internalProjectID != "" && provider.projectStore != nil {
		binding, ok, err := provider.projectStore.GetLibTVProjectBinding(ctx, internalProjectID)
		if err != nil {
			return "", fmt.Errorf("loading libtv project binding: %w", err)
		}
		if ok && strings.TrimSpace(binding.ProjectID) != "" {
			projectID := strings.TrimSpace(binding.ProjectID)
			provider.autoProjectIDs[cacheKey] = projectID
			return projectID, nil
		}
	}

	name := provider.autoProjectName(request)
	output, err := provider.runner.Run(
		ctx,
		provider.binPath,
		"project",
		"create",
		name,
		"--description="+provider.autoProjectDescription(request),
	)
	if err != nil {
		return "", commandError("project create", output, err)
	}
	projectID := projectIDFromCreateOutput(output)
	if projectID == "" {
		return "", fmt.Errorf("libtv CLI project create output missing project UUID: %s", truncateRunes(strings.TrimSpace(string(output)), 240))
	}

	provider.autoProjectIDs[cacheKey] = projectID
	if internalProjectID != "" && provider.projectStore != nil {
		now := provider.now().UTC().Format(time.RFC3339)
		if err := provider.projectStore.SaveLibTVProjectBinding(ctx, ProjectBinding{
			InternalProjectID:   internalProjectID,
			InternalProjectName: strings.TrimSpace(request.ProjectName),
			ProjectID:           projectID,
			ProjectName:         name,
			CreatedAt:           now,
			UpdatedAt:           now,
		}); err != nil {
			return "", fmt.Errorf("saving libtv project binding: %w", err)
		}
	}
	return projectID, nil
}

func (provider *Provider) autoProjectName(request generation.Request) string {
	name := strings.TrimSpace(request.ProjectName)
	if name == "" {
		name = strings.TrimSpace(request.ProjectID)
	}
	if name != "" {
		return truncateRunes("MediaGo - "+name, 80)
	}
	return "MediaGo Drama " + provider.now().UTC().Format("2006-01-02 15:04:05")
}

func (provider *Provider) autoProjectDescription(request generation.Request) string {
	parts := []string{"Created automatically by MediaGo Drama for generation tasks."}
	if projectID := strings.TrimSpace(request.ProjectID); projectID != "" {
		parts = append(parts, "MediaGo projectId: "+projectID+".")
	}
	if projectName := strings.TrimSpace(request.ProjectName); projectName != "" {
		parts = append(parts, "MediaGo projectName: "+projectName+".")
	}
	return strings.Join(parts, " ")
}

func autoProjectCacheKey(request generation.Request) string {
	if projectID := strings.TrimSpace(request.ProjectID); projectID != "" {
		return projectID
	}
	return defaultAutoProjectKey
}

func (provider *Provider) referenceNodeName(kind generation.Kind, index int) string {
	return fmt.Sprintf("mediago-reference-%s-%d-%02d", kind, provider.now().UnixNano(), index+1)
}

type uploadedReferenceNode struct {
	Node     string
	NodeName string
	Kind     generation.Kind
}

func (provider *Provider) uploadReferences(ctx context.Context, projectID string, files []referenceFile) ([]uploadedReferenceNode, error) {
	if len(files) == 0 {
		return nil, nil
	}

	nodes := make([]uploadedReferenceNode, 0, len(files))
	for index, file := range files {
		nodeName := provider.referenceNodeName(file.kind, index)
		args := []string{"upload"}
		if projectID != "" {
			args = append(args, "--project="+projectID)
		}
		args = append(args,
			"--resource="+file.path,
			"--type="+string(file.kind),
			nodeName,
		)
		output, attempts, err := provider.runUploadReference(ctx, args)
		if err != nil {
			return nil, uploadReferenceError(output, err, file, index, attempts)
		}
		payload, _ := extractJSONObject(output)
		node := firstNonEmpty(stringFromMap(payload, "id"), stringFromMap(payload, "nodeId"), stringFromMap(payload, "node_id"), nodeName)
		nodes = append(nodes, uploadedReferenceNode{
			Node:     node,
			NodeName: nodeName,
			Kind:     file.kind,
		})
	}
	return nodes, nil
}

func (provider *Provider) runUploadReference(ctx context.Context, args []string) ([]byte, int, error) {
	attempts := 0
	for {
		attempts++
		output, err := provider.runner.Run(ctx, provider.binPath, args...)
		if err == nil {
			return output, attempts, nil
		}
		if !isRetryableLibTVUploadFailure(output, err) || attempts > len(provider.uploadRetryDelays) {
			return output, attempts, err
		}
		if err := waitBeforeRetry(ctx, provider.uploadRetryDelays[attempts-1]); err != nil {
			return output, attempts, err
		}
	}
}

func uploadReferenceError(output []byte, err error, file referenceFile, index int, attempts int) error {
	size := int64(0)
	if info, statErr := os.Stat(file.path); statErr == nil {
		size = info.Size()
	}
	return fmt.Errorf(
		"libtv reference upload failed (index=%d, file=%s, kind=%s, size=%d bytes, attempts=%d): %w",
		index+1,
		filepath.Base(file.path),
		file.kind,
		size,
		attempts,
		commandError("upload", output, err),
	)
}

func referenceNodeMetadata(nodes []uploadedReferenceNode) []map[string]string {
	if len(nodes) == 0 {
		return nil
	}
	metadata := make([]map[string]string, 0, len(nodes))
	for _, node := range nodes {
		metadata = append(metadata, map[string]string{
			"kind":      string(node.Kind),
			"node":      node.Node,
			"node_name": node.NodeName,
		})
	}
	return metadata
}

func appendSetFlag(args *[]string, name string, value string) {
	value = strings.TrimSpace(value)
	if value != "" {
		*args = append(*args, "--set="+name+"="+value)
	}
}

func appendImageNodeParams(args *[]string, request generation.Request, hasReferences bool) {
	appendSetFlag(args, "ratio", paramString(request.Params, "ratio"))
	appendSetFlag(args, "resolution", paramString(request.Params, "resolution"))
	appendSetFlag(args, "quality", paramString(request.Params, "quality"))
	if request.RouteID == generation.RouteLibTVSeedream5Lite {
		appendSetFlag(args, "sequential", "0")
	}
	appendSetFlag(args, "count", "1")
	if hasReferences {
		appendSetFlag(args, "modeType", "image2image")
	}
}

func appendVideoNodeParams(args *[]string, params map[string]any, hasReferences bool) {
	appendSetFlag(args, "ratio", paramString(params, "ratio"))
	appendSetFlag(args, "resolution", paramString(params, "resolution"))
	appendSetFlag(args, "duration", paramString(params, "duration"))
	appendSetFlag(args, "enableSound", libTVEnableSoundValue(params["enableSound"]))
	appendSetFlag(args, "modeType", libTVModeTypeValue(params, hasReferences))
}

func validateImageParams(routeID string, params map[string]any) error {
	sequential := paramString(params, "sequential")
	if sequential == "" {
		return nil
	}
	if routeID != generation.RouteLibTVSeedream5Lite {
		return fmt.Errorf("libtv image parameter sequential is only supported by the Seedream route")
	}
	if sequential != "0" {
		return fmt.Errorf("libtv Seedream image parameter sequential must be 0 for single-image generation")
	}
	return nil
}

func libTVEnableSoundValue(value any) string {
	switch typed := value.(type) {
	case bool:
		if typed {
			return "on"
		}
		return "off"
	case string:
		text := strings.TrimSpace(strings.ToLower(typed))
		switch text {
		case "true", "1", "yes", "on":
			return "on"
		case "false", "0", "no", "off":
			return "off"
		default:
			return strings.TrimSpace(typed)
		}
	case nil:
		return ""
	default:
		text := strings.TrimSpace(fmt.Sprint(typed))
		if text == "1" {
			return "on"
		}
		return text
	}
}

func libTVModeTypeValue(params map[string]any, hasReferences bool) string {
	if value := paramString(params, "modeType"); value != "" {
		return value
	}
	if hasReferences {
		return "mixed2video"
	}
	return ""
}

func assetsFromDownloadDir(dir string) ([]generation.Asset, error) {
	assets := []generation.Asset{}
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if len(data) == 0 {
			return nil
		}
		mimeType := mimeTypeForPathAndData(path, data)
		kind, ok := kindForMIMEType(mimeType)
		if !ok {
			if strings.EqualFold(strings.TrimSpace(mimeType), "application/zip") {
				return fmt.Errorf("LibTV download returned a ZIP archive; the current integration supports single-image output only")
			}
			return fmt.Errorf("LibTV download file %s has unsupported media type %s", filepath.Base(path), mimeType)
		}
		assets = append(assets, generation.Asset{
			Kind:     kind,
			Base64:   base64.StdEncoding.EncodeToString(data),
			MIMEType: mimeType,
			Metadata: map[string]any{
				"filename": filepath.Base(path),
			},
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("reading libtv downloaded assets: %w", err)
	}
	return assets, nil
}

func boundLibTVProjectID() string {
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	projectFile := findLibTVProjectFile(wd)
	if projectFile == "" {
		return ""
	}
	data, err := os.ReadFile(projectFile)
	if err != nil {
		return ""
	}
	var payload any
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}
	return findLibTVProjectIDValue(payload)
}

func projectIDFromCreateOutput(output []byte) string {
	payload, err := extractJSONObject(output)
	if err == nil {
		if projectID := findLibTVProjectIDValue(payload); projectID != "" {
			return projectID
		}
	}
	return projectUUIDPattern.FindString(string(output))
}

func findLibTVProjectFile(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return ""
	}
	resolved, err := filepath.Abs(dir)
	if err != nil {
		return ""
	}
	for {
		candidate := filepath.Join(resolved, libTVProjectConfigPath)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(resolved)
		if parent == resolved {
			return ""
		}
		resolved = parent
	}
}

func findLibTVProjectIDValue(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{
			"projectId",
			"projectID",
			"project_id",
			"projectUuid",
			"projectUUID",
			"project_uuid",
			"uuid",
			"id",
		} {
			if id := stringValue(typed[key]); id != "" {
				return id
			}
		}
		for _, key := range []string{"project", "projectMeta", "project_meta", "currentProject", "current_project", "data", "result"} {
			if id := findLibTVProjectIDValue(typed[key]); id != "" {
				return id
			}
		}
	default:
		return ""
	}
	return ""
}

func missingLibTVProjectError() error {
	return fmt.Errorf("LibTV 命令需要画布项目 UUID；MediaGo 会自动创建项目，若自动创建失败，请设置 MEDIAGO_LIBTV_PROJECT_ID，或在服务启动目录执行 `libtv project use <项目UUID>` 生成 %s", libTVProjectConfigPath)
}

type referenceFiles struct {
	dir   string
	files []referenceFile
}

type referenceFile struct {
	path       string
	kind       generation.Kind
	recognized bool
}

func validateImageReferences(files []referenceFile) error {
	for index, file := range files {
		if !file.recognized {
			return fmt.Errorf("libtv image routes require a recognized image reference at index %d (%s)", index+1, filepath.Base(file.path))
		}
		if file.kind != generation.KindImage {
			return fmt.Errorf("libtv image routes only accept image references; reference %d is %s", index+1, file.kind)
		}
	}
	return nil
}

func (files referenceFiles) media() []referenceFile {
	return files.files
}

func materializeReferences(ctx context.Context, references []string) (referenceFiles, func(), error) {
	cleanup := func() {}
	values := compactStrings(references)
	if len(values) == 0 {
		return referenceFiles{}, cleanup, nil
	}

	dir, err := os.MkdirTemp("", defaultReferenceTempDir)
	if err != nil {
		return referenceFiles{}, cleanup, fmt.Errorf("creating libtv reference temp dir: %w", err)
	}
	cleanup = func() { _ = os.RemoveAll(dir) }

	files := referenceFiles{
		dir:   dir,
		files: make([]referenceFile, 0, len(values)),
	}
	for index, value := range values {
		file, err := materializeReference(ctx, dir, index, value)
		if err != nil {
			cleanup()
			return referenceFiles{}, func() {}, err
		}
		files.files = append(files.files, file)
	}
	return files, cleanup, nil
}

func materializeReference(ctx context.Context, dir string, index int, value string) (referenceFile, error) {
	if strings.HasPrefix(strings.ToLower(value), "data:") {
		mediaType, data, ok := strings.Cut(value, ",")
		if !ok {
			return referenceFile{}, fmt.Errorf("invalid data uri reference")
		}
		decoded, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return referenceFile{}, fmt.Errorf("decoding data uri reference: %w", err)
		}
		path := filepath.Join(dir, fmt.Sprintf("reference-%02d%s", index+1, extensionForMediaType(mediaType)))
		if err := os.WriteFile(path, decoded, 0o600); err != nil {
			return referenceFile{}, fmt.Errorf("writing libtv reference file: %w", err)
		}
		kind, recognized := referenceKindForMediaType(mediaType)
		if !recognized {
			kind, recognized = referenceKindForMediaType(http.DetectContentType(decoded))
		}
		return referenceFile{path: path, kind: kind, recognized: recognized}, nil
	}
	if strings.HasPrefix(strings.ToLower(value), "http://") ||
		strings.HasPrefix(strings.ToLower(value), "https://") {
		mimeType, data, err := readHTTPReference(ctx, value)
		if err != nil {
			return referenceFile{}, fmt.Errorf("downloading libtv reference: %w", err)
		}
		path := filepath.Join(dir, fmt.Sprintf("reference-%02d%s", index+1, extensionForMediaType(firstNonEmpty(mimeType, value))))
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return referenceFile{}, fmt.Errorf("writing libtv reference file: %w", err)
		}
		kind, recognized := referenceKindForMediaType(mimeType)
		if !recognized {
			kind, recognized = referenceKindForMediaType(referenceMIMETypeFromURL(value))
		}
		if !recognized {
			kind, recognized = referenceKindForMediaType(http.DetectContentType(data))
		}
		return referenceFile{path: path, kind: kind, recognized: recognized}, nil
	}
	if strings.HasPrefix(strings.ToLower(value), "file://") {
		value = strings.TrimPrefix(value, "file://")
	}
	if filepath.IsAbs(value) {
		path, err := readableFile(value)
		if err != nil {
			return referenceFile{}, err
		}
		kind, recognized := referenceKindForPath(path)
		return referenceFile{path: path, kind: kind, recognized: recognized}, nil
	}
	return referenceFile{}, fmt.Errorf("libtv CLI references must be local files, HTTP URLs, or data URIs")
}

func readHTTPReference(ctx context.Context, reference string) (string, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, reference, nil)
	if err != nil {
		return "", nil, err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", nil, fmt.Errorf("reference request failed with status %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, referenceByteLimit+1))
	if err != nil {
		return "", nil, err
	}
	if int64(len(data)) > referenceByteLimit {
		return "", nil, fmt.Errorf("reference exceeds %d bytes", referenceByteLimit)
	}
	if len(data) == 0 {
		return "", nil, fmt.Errorf("reference is empty")
	}
	mimeType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	if mimeType == "" {
		mimeType = referenceMIMETypeFromURL(reference)
	}
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	return mimeType, data, nil
}

func readableFile(path string) (string, error) {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("reference path %s is a directory", resolved)
	}
	return resolved, nil
}

func referenceKindForMediaType(mediaType string) (generation.Kind, bool) {
	mediaType = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(mediaType)), "data:")
	mediaType, _, _ = strings.Cut(mediaType, ";")
	if strings.HasPrefix(mediaType, "image/") {
		return generation.KindImage, true
	}
	if strings.HasPrefix(mediaType, "audio/") {
		return generation.KindAudio, true
	}
	if strings.HasPrefix(mediaType, "video/") {
		return generation.KindVideo, true
	}
	return generation.KindImage, false
}

func referenceKindForPath(path string) (generation.Kind, bool) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff", ".avif", ".heic", ".heif":
		return generation.KindImage, true
	case ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg":
		return generation.KindAudio, true
	case ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mkv", ".m4v":
		return generation.KindVideo, true
	default:
		return generation.KindImage, false
	}
}

func extensionForMediaType(mediaType string) string {
	mediaType = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(mediaType)), "data:")
	mediaType, _, _ = strings.Cut(mediaType, ";")
	switch mediaType {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav", "audio/x-wav":
		return ".wav"
	default:
		if strings.Contains(mediaType, ".") {
			return filepath.Ext(mediaType)
		}
		if strings.HasPrefix(mediaType, "video/") {
			return ".mp4"
		}
		if strings.HasPrefix(mediaType, "audio/") {
			return ".mp3"
		}
		return ".png"
	}
}

func referenceMIMETypeFromURL(value string) string {
	path := value
	if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	return extensionForPath(path)
}

func extensionForPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	default:
		return ""
	}
}

func mimeTypeForPathAndData(path string, data []byte) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".zip":
		return "application/zip"
	default:
		return http.DetectContentType(data)
	}
}

func kindForMIMEType(mimeType string) (generation.Kind, bool) {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return generation.KindImage, true
	case strings.HasPrefix(mimeType, "video/"):
		return generation.KindVideo, true
	case strings.HasPrefix(mimeType, "audio/"):
		return generation.KindAudio, true
	default:
		return "", false
	}
}

func commandError(commandName string, output []byte, err error) error {
	message := strings.TrimSpace(string(output))
	if isMissingLibTVProjectOutput(message) {
		return fmt.Errorf("%w: %s", missingLibTVProjectError(), message)
	}
	if message == "" {
		return fmt.Errorf("libtv CLI %s failed: %w", commandName, err)
	}
	return fmt.Errorf("libtv CLI %s failed: %w: %s", commandName, err, message)
}

func isRetryableLibTVUploadFailure(output []byte, err error) bool {
	text := strings.ToLower(strings.TrimSpace(string(output)))
	if err != nil {
		text += " " + strings.ToLower(err.Error())
	}
	for _, token := range []string{
		"fetch failed",
		"network",
		"timeout",
		"timed out",
		"econnreset",
		"econnrefused",
		"etimedout",
		"eai_again",
		"socket hang up",
		"502",
		"503",
		"504",
	} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func waitBeforeRetry(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func isMissingLibTVProjectOutput(message string) bool {
	message = strings.ToLower(strings.TrimSpace(message))
	return strings.Contains(message, "缺少项目") ||
		strings.Contains(message, "project use") ||
		strings.Contains(message, "project.json")
}

func isPendingDownloadOutput(output []byte) bool {
	text := strings.ToLower(strings.TrimSpace(string(output)))
	for _, token := range []string{
		"生成中",
		"排队",
		"处理中",
		"未完成",
		"暂无",
		"没有可下载",
		"无可下载",
		"no resource",
		"not ready",
		"pending",
		"processing",
		"running",
	} {
		if strings.Contains(text, token) {
			return true
		}
	}
	return false
}

func extractJSONObject(output []byte) (map[string]any, error) {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return nil, errors.New("libtv CLI returned empty output")
	}
	var direct map[string]any
	if err := json.Unmarshal([]byte(text), &direct); err == nil {
		return direct, nil
	}
	for start := strings.Index(text, "{"); start >= 0 && start < len(text); {
		depth := 0
		inString := false
		escaped := false
		for index := start; index < len(text); index++ {
			char := text[index]
			if inString {
				if escaped {
					escaped = false
					continue
				}
				if char == '\\' {
					escaped = true
					continue
				}
				if char == '"' {
					inString = false
				}
				continue
			}
			if char == '"' {
				inString = true
				continue
			}
			if char == '{' {
				depth++
			}
			if char == '}' {
				depth--
				if depth == 0 {
					candidate := text[start : index+1]
					var payload map[string]any
					if err := json.Unmarshal([]byte(candidate), &payload); err == nil {
						return payload, nil
					}
					break
				}
			}
		}
		next := strings.Index(text[start+1:], "{")
		if next < 0 {
			break
		}
		start += next + 1
	}
	return nil, fmt.Errorf("libtv CLI output did not contain a JSON object")
}

// ResolveBinaryPath resolves an explicit binary, a vendored tools directory, or PATH.
func ResolveBinaryPath(explicitPath string, binDir string) (string, error) {
	binaryName := executableName(defaultBinaryName)
	if explicitPath = strings.TrimSpace(explicitPath); explicitPath != "" {
		return executableFile(explicitPath)
	}
	if binDir = strings.TrimSpace(binDir); binDir != "" {
		candidates := []string{
			filepath.Join(binDir, "libtv", binaryName),
			filepath.Join(binDir, binaryName),
		}
		for _, candidate := range candidates {
			if path, err := executableFile(candidate); err == nil {
				return path, nil
			}
		}
	}

	path, err := exec.LookPath(binaryName)
	if err != nil {
		return "", fmt.Errorf("libtv CLI binary %q was not found", binaryName)
	}
	return path, nil
}

func executableName(name string) string {
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(name), ".exe") {
		return name + ".exe"
	}
	return name
}

func executableFile(path string) (string, error) {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolving libtv CLI path %s: %w", path, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("libtv CLI path %s is a directory", resolved)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("libtv CLI path %s is not executable", resolved)
	}
	return resolved, nil
}

type execCommandRunner struct{}

func (execCommandRunner) Run(ctx context.Context, path string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, path, args...).CombinedOutput()
}

func paramString(params map[string]any, name string) string {
	value, ok := params[name]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case int:
		return fmt.Sprintf("%d", typed)
	case int64:
		return fmt.Sprintf("%d", typed)
	case float64:
		return formatNumber(typed)
	case float32:
		return formatNumber(float64(typed))
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func stringFromMap(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
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

func compactStrings(values []string) []string {
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func taskIDPrefix(request generation.Request) string {
	if request.RouteID != "" {
		return request.RouteID
	}
	if request.ModelID != "" {
		return request.ModelID
	}
	return request.Model
}

func joinProviderTaskID(prefix string, projectID string, node string) string {
	prefix = strings.TrimSpace(prefix)
	projectID = strings.TrimSpace(projectID)
	node = strings.TrimSpace(node)
	if prefix == "" {
		return strings.Trim(projectID+":"+node, ":")
	}
	if projectID == "" {
		return prefix + ":" + node
	}
	return prefix + ":" + projectID + ":" + node
}

func splitProviderTaskID(id string) (string, string, string) {
	prefix, taskID, ok := strings.Cut(strings.TrimSpace(id), ":")
	if !ok {
		return "", "", ""
	}
	projectID, node, ok := strings.Cut(taskID, ":")
	if !ok {
		return prefix, "", strings.TrimSpace(taskID)
	}
	return prefix, strings.TrimSpace(projectID), strings.TrimSpace(node)
}

func formatNumber(value float64) string {
	text := fmt.Sprintf("%.6f", value)
	text = strings.TrimRight(text, "0")
	return strings.TrimRight(text, ".")
}

func truncateRunes(value string, maxLength int) string {
	if maxLength <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maxLength {
		return value
	}
	if maxLength <= 3 {
		return string(runes[:maxLength])
	}
	return string(runes[:maxLength-3]) + "..."
}
