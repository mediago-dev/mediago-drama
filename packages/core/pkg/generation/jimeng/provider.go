// Package jimeng adapts the locally bundled Dreamina/Jimeng CLI to generation.
package jimeng

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	defaultBinaryName       = "dreamina"
	defaultImagePoll        = 30
	defaultImageResultPoll  = 300
	jimengImageCountParam   = "_mediago_task_count"
	jimengMaxCLIImageCount  = 4
	jimengDefaultImageCount = 1
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

// Config controls the Jimeng CLI provider.
type Config struct {
	BinPath string
	BinDir  string
	Runner  CommandRunner
}

// Provider calls the local Jimeng CLI.
type Provider struct {
	binPath string
	runner  CommandRunner
}

// NewProvider creates a Jimeng CLI generation provider.
func NewProvider(config Config) (*Provider, error) {
	path, err := ResolveBinaryPath(config.BinPath, config.BinDir)
	if err != nil {
		return nil, err
	}
	runner := config.Runner
	if runner == nil {
		runner = execCommandRunner{}
	}
	return &Provider{binPath: path, runner: runner}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return "jimeng-cli"
}

// Generate submits image or video generation through the CLI.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}

	route, ok, err := generation.ResolveRequestRouteForProvider(request, generation.ProviderJimeng)
	if err != nil {
		return generation.Response{}, err
	}
	if ok {
		if err := generation.ValidateRequestForRoute(request, route); err != nil {
			return generation.Response{}, err
		}
		request = generation.ApplyRoute(request, route)
	}

	adapter := ""
	if ok {
		adapter = route.Adapter
	}
	switch adapter {
	case generation.AdapterJimengCLIImage:
		return provider.generateImage(ctx, request)
	case generation.AdapterJimengCLIVideo:
		return provider.generateVideo(ctx, request)
	default:
		switch request.Kind {
		case generation.KindImage:
			return provider.generateImage(ctx, request)
		case generation.KindVideo:
			return provider.generateVideo(ctx, request)
		default:
			return generation.Response{}, fmt.Errorf("unsupported jimeng adapter %q", adapter)
		}
	}
}

// Get fetches async task status through dreamina query_result.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	prefix, taskID := splitTaskID(id)
	if strings.TrimSpace(taskID) == "" {
		return generation.Response{}, fmt.Errorf("generation id is required")
	}

	response, err := provider.queryResult(ctx, taskID, kindForTaskPrefix(prefix), prefix, "")
	if err != nil {
		return generation.Response{}, err
	}
	if response.ID == "" {
		response.ID = joinTaskID(prefix, taskID)
	}
	return response, nil
}

// kindForTaskPrefix resolves the media kind of an async task from its route prefix,
// so background polling tags recovered assets correctly (image vs video).
func kindForTaskPrefix(prefix string) generation.Kind {
	if route, ok := generation.FindRouteByTaskPrefix(strings.TrimSpace(prefix)); ok && route.Kind != "" {
		return route.Kind
	}
	return generation.KindVideo
}

func (provider *Provider) generateImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	tempDir, cleanup, err := materializeReferences(ctx, request.ReferenceURLs)
	if err != nil {
		return generation.Response{}, err
	}
	defer cleanup()

	imageCount := boundedImageCount(paramInt(request.Params, jimengImageCountParam, paramInt(request.Params, "n", jimengDefaultImageCount)))
	if imageCount <= 1 {
		return provider.generateSingleImage(ctx, request, tempDir)
	}

	progressCallback, hasProgressCallback := generation.ProgressCallbackFromOptions(request.Options)
	responses := make([]generation.Response, 0, imageCount)
	for index := 0; index < imageCount; index++ {
		response, err := provider.generateSingleImage(ctx, request, tempDir)
		if err != nil {
			return generation.Response{}, err
		}
		responses = append(responses, response)
		if hasProgressCallback {
			progressResponse := combineImageResponses(responses)
			progressCallback(ctx, generation.ProgressEvent{
				Response:  progressResponse,
				Completed: index + 1,
				Total:     imageCount,
			})
		}
	}
	return combineImageResponses(responses), nil
}

func (provider *Provider) generateSingleImage(ctx context.Context, request generation.Request, tempDir referenceFiles) (generation.Response, error) {
	command := "text2image"
	args := []string{command}
	if len(tempDir.paths) > 0 {
		command = "image2image"
		args = []string{command, "--images=" + strings.Join(tempDir.paths, ",")}
	}
	args = append(args, "--prompt="+request.Prompt)
	appendStringFlag(&args, "ratio", paramString(request.Params, "ratio"))
	appendStringFlag(&args, "resolution_type", paramString(request.Params, "resolutionType"))
	appendStringFlag(&args, "model_version", request.Model)
	appendIntFlag(&args, "poll", paramInt(request.Params, "poll", defaultImagePoll))

	output, err := provider.runner.Run(ctx, provider.binPath, args...)
	if err != nil {
		return generation.Response{}, commandError(command, output, err)
	}
	response, err := parseCLIResponse(output, generation.KindImage, taskIDPrefix(request), request.Model)
	if err != nil {
		return generation.Response{}, err
	}

	resultPoll := paramInt(request.Params, "resultPoll", defaultImageResultPoll)
	return provider.responseWithQueriedImageResult(ctx, response, taskIDPrefix(request), request.Model, resultPoll)
}

func (provider *Provider) responseWithQueriedImageResult(ctx context.Context, response generation.Response, prefix string, model string, pollSeconds int) (generation.Response, error) {
	taskID := taskIDFromResponse(response, prefix)
	if taskID == "" {
		return response, nil
	}

	queried, err := provider.queryResult(ctx, taskID, generation.KindImage, prefix, model)
	if err != nil {
		if len(response.Assets) > 0 {
			return response, nil
		}
		return generation.Response{}, err
	}
	queried = normalizeQueriedImageResponse(queried, response, prefix, taskID)
	if imageQueryResultReady(queried) {
		return queried, nil
	}
	queried, err = provider.pollImageResult(ctx, taskID, prefix, model, response, queried, pollSeconds)
	if err != nil {
		if len(response.Assets) > 0 {
			return response, nil
		}
		return generation.Response{}, err
	}
	if len(queried.Assets) == 0 && len(response.Assets) > 0 {
		return response, nil
	}

	return queried, nil
}

func (provider *Provider) pollImageResult(
	ctx context.Context,
	taskID string,
	prefix string,
	model string,
	initial generation.Response,
	current generation.Response,
	pollSeconds int,
) (generation.Response, error) {
	if pollSeconds <= 0 {
		return current, nil
	}

	pollCtx, cancel := context.WithTimeout(ctx, time.Duration(pollSeconds)*time.Second)
	defer cancel()

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	last := current
	for {
		select {
		case <-pollCtx.Done():
			if errors.Is(pollCtx.Err(), context.DeadlineExceeded) {
				return last, nil
			}
			return last, pollCtx.Err()
		case <-ticker.C:
			queried, err := provider.queryResult(pollCtx, taskID, generation.KindImage, prefix, model)
			if err != nil {
				if len(last.Assets) > 0 {
					return last, nil
				}
				// The result poll budget was exhausted while a query_result subprocess
				// was mid-flight, so our own deadline killed it (surfaces as
				// "signal: killed"). This is a timeout, not a real failure — return the
				// last known "still querying" response so the caller can hand the task
				// off to background polling instead of failing it.
				if pollCtx.Err() != nil {
					return last, nil
				}
				return last, err
			}
			last = normalizeQueriedImageResponse(queried, initial, prefix, taskID)
			if imageQueryResultReady(last) {
				return last, nil
			}
		}
	}
}

func normalizeQueriedImageResponse(queried generation.Response, initial generation.Response, prefix string, taskID string) generation.Response {
	if queried.ID == "" {
		queried.ID = joinTaskID(prefix, taskID)
	}
	if queried.Model == "" {
		queried.Model = initial.Model
	}
	if queried.Status == "" {
		queried.Status = initial.Status
	}

	return queried
}

func imageQueryResultReady(response generation.Response) bool {
	if response.Status == "failed" {
		return true
	}

	return len(response.Assets) > 0
}

func (provider *Provider) queryResult(ctx context.Context, taskID string, kind generation.Kind, prefix string, model string) (generation.Response, error) {
	output, err := provider.runner.Run(ctx, provider.binPath, "query_result", "--submit_id="+taskID)
	if err != nil {
		return generation.Response{}, commandError("query_result", output, err)
	}
	response, err := parseCLIResponse(output, kind, prefix, model)
	if err != nil {
		return generation.Response{}, err
	}
	if response.ID == "" || strings.TrimSpace(response.ID) == strings.TrimSpace(prefix) {
		response.ID = joinTaskID(prefix, taskID)
	}

	return response, nil
}

func boundedImageCount(value int) int {
	return max(1, min(value, jimengMaxCLIImageCount))
}

func combineImageResponses(responses []generation.Response) generation.Response {
	if len(responses) == 0 {
		return generation.Response{Status: "completed"}
	}

	combined := generation.Response{
		ID:       responses[0].ID,
		Status:   "completed",
		Model:    responses[0].Model,
		Assets:   []generation.Asset{},
		Metadata: map[string]any{"results": []any{}},
	}
	results := make([]any, 0, len(responses))
	for _, response := range responses {
		if combined.ID == "" {
			combined.ID = response.ID
		}
		if combined.Model == "" {
			combined.Model = response.Model
		}
		if response.Status == "failed" {
			combined.Status = "failed"
			if errorMessage := stringFromMetadata(response.Metadata, "error"); errorMessage != "" {
				combined.Metadata["error"] = errorMessage
			}
		} else if combined.Status != "failed" && response.Status != "" && response.Status != "completed" {
			combined.Status = response.Status
		}
		combined.Assets = append(combined.Assets, response.Assets...)
		if result, ok := response.Metadata["result"]; ok {
			results = append(results, result)
		} else if response.Metadata != nil {
			results = append(results, response.Metadata)
		}
	}
	combined.Metadata["results"] = results
	combined.Metadata["image_count"] = len(responses)
	return combined
}

func (provider *Provider) generateVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	tempDir, cleanup, err := materializeReferences(ctx, request.ReferenceURLs)
	if err != nil {
		return generation.Response{}, err
	}
	defer cleanup()

	modelVersion := firstNonEmpty(paramString(request.Params, "modelVersion"), request.Model)
	command := "text2video"
	args := []string{command}
	media := tempDir.media()
	switch {
	case len(media) == 0:
		args = append(args, "--prompt="+request.Prompt)
		appendStringFlag(&args, "duration", paramString(request.Params, "duration"))
		appendStringFlag(&args, "ratio", paramString(request.Params, "ratio"))
		appendStringFlag(&args, "video_resolution", paramString(request.Params, "videoResolution"))
		appendStringFlag(&args, "model_version", modelVersion)
	case len(media) == 1 && media[0].kind == generation.KindImage:
		command = "image2video"
		args = []string{command, "--image=" + media[0].path}
		args = append(args, "--prompt="+request.Prompt)
		appendStringFlag(&args, "duration", paramString(request.Params, "duration"))
		appendStringFlag(&args, "video_resolution", paramString(request.Params, "videoResolution"))
		appendStringFlag(&args, "model_version", modelVersion)
	default:
		command = "multimodal2video"
		args = []string{command}
		for _, item := range media {
			switch item.kind {
			case generation.KindAudio:
				args = append(args, "--audio="+item.path)
			case generation.KindVideo:
				args = append(args, "--video="+item.path)
			default:
				args = append(args, "--image="+item.path)
			}
		}
		args = append(args, "--prompt="+request.Prompt)
		appendStringFlag(&args, "duration", paramString(request.Params, "duration"))
		appendStringFlag(&args, "ratio", paramString(request.Params, "ratio"))
		appendStringFlag(&args, "video_resolution", paramString(request.Params, "videoResolution"))
		appendStringFlag(&args, "model_version", modelVersion)
	}
	appendIntFlag(&args, "poll", paramInt(request.Params, "poll", 0))

	output, err := provider.runner.Run(ctx, provider.binPath, args...)
	if err != nil {
		return generation.Response{}, commandError(command, output, err)
	}
	return parseCLIResponse(output, generation.KindVideo, taskIDPrefix(request), request.Model)
}

// ResolveBinaryPath resolves an explicit binary, a vendored tools directory, or PATH.
func ResolveBinaryPath(explicitPath string, binDir string) (string, error) {
	binaryName := executableName(defaultBinaryName)
	if explicitPath = strings.TrimSpace(explicitPath); explicitPath != "" {
		return executableFile(explicitPath)
	}
	if binDir = strings.TrimSpace(binDir); binDir != "" {
		candidates := []string{
			filepath.Join(binDir, defaultBinaryName, binaryName),
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
		return "", fmt.Errorf("jimeng CLI binary %q was not found", binaryName)
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
		return "", fmt.Errorf("resolving jimeng CLI path %s: %w", path, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("jimeng CLI path %s is a directory", resolved)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("jimeng CLI path %s is not executable", resolved)
	}
	return resolved, nil
}

type execCommandRunner struct{}

func (execCommandRunner) Run(ctx context.Context, path string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, path, args...)
	return command.CombinedOutput()
}

type referenceFiles struct {
	dir   string
	paths []string
	files []referenceFile
}

type referenceFile struct {
	path string
	kind generation.Kind
}

func (files referenceFiles) media() []referenceFile {
	if len(files.files) > 0 {
		return files.files
	}
	media := make([]referenceFile, 0, len(files.paths))
	for _, path := range files.paths {
		media = append(media, referenceFile{path: path, kind: generation.KindImage})
	}
	return media
}

func materializeReferences(ctx context.Context, references []string) (referenceFiles, func(), error) {
	cleanup := func() {}
	values := compactStrings(references)
	if len(values) == 0 {
		return referenceFiles{}, cleanup, nil
	}

	dir, err := os.MkdirTemp("", "mediago-jimeng-ref-*")
	if err != nil {
		return referenceFiles{}, cleanup, fmt.Errorf("creating jimeng reference temp dir: %w", err)
	}
	cleanup = func() { _ = os.RemoveAll(dir) }

	files := referenceFiles{
		dir:   dir,
		paths: make([]string, 0, len(values)),
		files: make([]referenceFile, 0, len(values)),
	}
	for index, value := range values {
		file, err := materializeReference(ctx, dir, index, value)
		if err != nil {
			cleanup()
			return referenceFiles{}, func() {}, err
		}
		files.paths = append(files.paths, file.path)
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
		extension := extensionForDataURI(mediaType)
		path := filepath.Join(dir, fmt.Sprintf("reference-%02d%s", index+1, extension))
		if err := os.WriteFile(path, decoded, 0o600); err != nil {
			return referenceFile{}, fmt.Errorf("writing jimeng reference file: %w", err)
		}
		return referenceFile{path: path, kind: referenceKindForMediaType(mediaType)}, nil
	}
	if strings.HasPrefix(strings.ToLower(value), "http://") ||
		strings.HasPrefix(strings.ToLower(value), "https://") {
		mimeType, data, err := readHTTPReference(ctx, value)
		if err != nil {
			return referenceFile{}, fmt.Errorf("downloading jimeng reference: %w", err)
		}
		path := filepath.Join(dir, fmt.Sprintf("reference-%02d%s", index+1, extensionForDataURI(mimeType)))
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return referenceFile{}, fmt.Errorf("writing jimeng reference file: %w", err)
		}
		return referenceFile{path: path, kind: referenceKindForMediaType(firstNonEmpty(mimeType, value))}, nil
	}
	if strings.HasPrefix(strings.ToLower(value), "file://") {
		value = strings.TrimPrefix(value, "file://")
	}
	if filepath.IsAbs(value) {
		path, err := executableOrReadableFile(value)
		if err != nil {
			return referenceFile{}, err
		}
		return referenceFile{path: path, kind: referenceKindForPath(path)}, nil
	}
	return referenceFile{}, fmt.Errorf("jimeng CLI references must be local files or data URIs")
}

const jimengReferenceByteLimit int64 = 200 << 20

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
	data, err := io.ReadAll(io.LimitReader(response.Body, jimengReferenceByteLimit+1))
	if err != nil {
		return "", nil, err
	}
	if int64(len(data)) > jimengReferenceByteLimit {
		return "", nil, fmt.Errorf("reference exceeds %d bytes", jimengReferenceByteLimit)
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

func executableOrReadableFile(path string) (string, error) {
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

func referenceKindForMediaType(mediaType string) generation.Kind {
	mediaType = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(mediaType)), "data:")
	mediaType, _, _ = strings.Cut(mediaType, ";")
	if strings.HasPrefix(mediaType, "audio/") {
		return generation.KindAudio
	}
	if strings.HasPrefix(mediaType, "video/") {
		return generation.KindVideo
	}
	if strings.HasPrefix(mediaType, "image/") {
		return generation.KindImage
	}
	return referenceKindForPath(mediaType)
}

func referenceKindForPath(value string) generation.Kind {
	parsed, err := url.Parse(strings.TrimSpace(value))
	pathValue := value
	if err == nil {
		pathValue = parsed.Path
	}
	switch strings.ToLower(filepath.Ext(pathValue)) {
	case ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus":
		return generation.KindAudio
	case ".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm":
		return generation.KindVideo
	default:
		return generation.KindImage
	}
}

func referenceMIMETypeFromURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	pathValue := value
	if err == nil {
		pathValue = parsed.Path
	}
	if mimeType := mime.TypeByExtension(filepath.Ext(pathValue)); mimeType != "" {
		return strings.TrimSpace(strings.Split(mimeType, ";")[0])
	}
	return ""
}

func extensionForDataURI(mediaType string) string {
	mediaType = strings.TrimPrefix(mediaType, "data:")
	mediaType, _, _ = strings.Cut(mediaType, ";")
	if mediaType == "" {
		return ".png"
	}
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/mp4", "audio/x-m4a":
		return ".m4a"
	case "audio/wav", "audio/wave", "audio/x-wav":
		return ".wav"
	case "audio/webm":
		return ".webm"
	}
	if extensions, err := mime.ExtensionsByType(mediaType); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	if strings.Contains(mediaType, "jpeg") {
		return ".jpg"
	}
	if strings.Contains(mediaType, "webp") {
		return ".webp"
	}
	if strings.Contains(mediaType, "mp4") {
		return ".mp4"
	}
	return ".png"
}

func commandError(commandName string, output []byte, err error) error {
	message := strings.TrimSpace(string(output))
	if message == "" {
		return fmt.Errorf("jimeng CLI %s failed: %w", commandName, err)
	}
	return fmt.Errorf("jimeng CLI %s failed: %w: %s", commandName, err, message)
}

func parseCLIResponse(output []byte, kind generation.Kind, prefix string, model string) (generation.Response, error) {
	payload, err := extractJSONObject(output)
	if err != nil {
		return generation.Response{}, err
	}
	status := normalizeStatus(firstNonEmpty(
		stringFromMap(payload, "gen_status"),
		stringFromMap(payload, "status"),
		stringFromMap(payload, "task_status"),
	))
	taskID := firstNonEmpty(
		stringFromMap(payload, "submit_id"),
		stringFromMap(payload, "task_id"),
		stringFromMap(payload, "id"),
	)
	response := generation.Response{
		ID:     joinTaskID(prefix, taskID),
		Status: firstNonEmpty(status, "submitted"),
		Model:  firstNonEmpty(stringFromMap(payload, "model"), stringFromMap(payload, "model_version"), model),
		Assets: assetsFromPayload(payload, kind),
		Metadata: map[string]any{
			"result": payload,
		},
	}
	if response.Status == "failed" {
		response.Metadata["error"] = firstNonEmpty(
			stringFromMap(payload, "fail_reason"),
			stringFromMap(payload, "error"),
			stringFromMap(payload, "message"),
			stringFromMap(payload, "errmsg"),
		)
	}
	return response, nil
}

func extractJSONObject(output []byte) (map[string]any, error) {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return nil, errors.New("jimeng CLI returned empty output")
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
	return nil, fmt.Errorf("jimeng CLI output did not contain a JSON object: %s", truncate(text, 240))
}

func assetsFromPayload(payload map[string]any, kind generation.Kind) []generation.Asset {
	urls := uniqueStrings(collectURLs(payload, nil))
	assets := make([]generation.Asset, 0, len(urls))
	for _, value := range urls {
		assets = append(assets, generation.Asset{Kind: kind, URL: value})
	}
	return assets
}

func collectURLs(value any, urls []string) []string {
	switch typed := value.(type) {
	case string:
		if strings.HasPrefix(typed, "http://") || strings.HasPrefix(typed, "https://") || strings.HasPrefix(typed, "data:") {
			return append(urls, typed)
		}
	case []any:
		for _, item := range typed {
			urls = collectURLs(item, urls)
		}
	case map[string]any:
		for _, item := range typed {
			urls = collectURLs(item, urls)
		}
	}
	return urls
}

func normalizeStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "querying", "running", "processing", "pending", "queueing", "queued", "submitted":
		return "submitted"
	case "success", "succeeded", "completed", "done", "finish", "finished":
		return "completed"
	case "fail", "failed", "error":
		return "failed"
	default:
		return strings.TrimSpace(value)
	}
}

func appendStringFlag(args *[]string, name string, value string) {
	value = strings.TrimSpace(value)
	if value != "" {
		*args = append(*args, "--"+name+"="+value)
	}
}

func appendIntFlag(args *[]string, name string, value int) {
	if value > 0 {
		*args = append(*args, fmt.Sprintf("--%s=%d", name, value))
	}
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

func paramInt(params map[string]any, name string, fallback int) int {
	text := paramString(params, name)
	if text == "" {
		return fallback
	}
	var value int
	if _, err := fmt.Sscanf(text, "%d", &value); err == nil {
		return value
	}
	return fallback
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

func stringFromMetadata(values map[string]any, key string) string {
	if len(values) == 0 {
		return ""
	}
	value, ok := values[key]
	if !ok || value == nil {
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

func uniqueStrings(values []string) []string {
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

func joinTaskID(prefix string, id string) string {
	prefix = strings.TrimSpace(prefix)
	id = strings.TrimSpace(id)
	if prefix == "" {
		return id
	}
	if id == "" {
		return prefix
	}
	if strings.HasPrefix(id, prefix+":") {
		return id
	}
	return prefix + ":" + id
}

func splitTaskID(id string) (string, string) {
	prefix, taskID, ok := strings.Cut(strings.TrimSpace(id), ":")
	if !ok {
		return "", strings.TrimSpace(id)
	}
	return prefix, taskID
}

func taskIDFromResponse(response generation.Response, prefix string) string {
	responseID := strings.TrimSpace(response.ID)
	prefix = strings.TrimSpace(prefix)
	if responseID == "" || responseID == prefix {
		if result, ok := response.Metadata["result"].(map[string]any); ok {
			return firstNonEmpty(
				stringFromMap(result, "submit_id"),
				stringFromMap(result, "task_id"),
				stringFromMap(result, "id"),
			)
		}
		return ""
	}
	_, taskID := splitTaskID(responseID)
	if prefix != "" && strings.HasPrefix(responseID, prefix+":") {
		return taskID
	}
	return responseID
}

func formatNumber(value float64) string {
	text := fmt.Sprintf("%.6f", value)
	text = strings.TrimRight(text, "0")
	return strings.TrimRight(text, ".")
}

func truncate(value string, maxLength int) string {
	if len(value) <= maxLength {
		return value
	}
	return value[:maxLength] + "..."
}
