// Package pippit adapts the locally bundled Pippit / Xiaoyunque CLI to generation.
package pippit

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	defaultBinaryName       = "pippit-tool-cli"
	defaultQueryDownloadDir = "mediago-pippit-result-*"
	referenceByteLimit      = 200 << 20
)

// CommandRunner executes one CLI command and returns combined output.
type CommandRunner interface {
	Run(ctx context.Context, path string, env map[string]string, args ...string) ([]byte, error)
}

// CommandRunnerFunc adapts a function into a CommandRunner.
type CommandRunnerFunc func(ctx context.Context, path string, env map[string]string, args ...string) ([]byte, error)

// Run executes the configured function.
func (fn CommandRunnerFunc) Run(ctx context.Context, path string, env map[string]string, args ...string) ([]byte, error) {
	return fn(ctx, path, env, args...)
}

// Config controls the Pippit CLI provider.
type Config struct {
	APIKey  string
	BaseURL string
	BinPath string
	BinDir  string
	Runner  CommandRunner
}

// Provider calls the local Pippit CLI.
type Provider struct {
	apiKey  string
	baseURL string
	binPath string
	runner  CommandRunner
}

// NewProvider creates a Pippit CLI generation provider.
func NewProvider(config Config) (*Provider, error) {
	path, err := ResolveBinaryPath(config.BinPath, config.BinDir)
	if err != nil {
		return nil, err
	}
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, generation.ErrMissingAPIKey
	}
	runner := config.Runner
	if runner == nil {
		runner = execCommandRunner{}
	}
	return &Provider{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		binPath: path,
		runner:  runner,
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return "pippit-cli"
}

// Generate submits video generation through the Pippit CLI.
func (provider *Provider) Generate(ctx context.Context, request generation.Request) (generation.Response, error) {
	if strings.TrimSpace(request.Prompt) == "" {
		return generation.Response{}, generation.ErrMissingPrompt
	}
	route, ok, err := generation.ResolveRequestRouteForProvider(request, generation.ProviderXiaoyunque)
	if err != nil {
		return generation.Response{}, err
	}
	if ok {
		if err := generation.ValidateRequestForRoute(request, route); err != nil {
			return generation.Response{}, err
		}
		request = generation.ApplyRoute(request, route)
	}
	if request.Kind != "" && request.Kind != generation.KindVideo {
		return generation.Response{}, fmt.Errorf("pippit CLI only supports video generation")
	}

	tempDir, cleanup, err := materializeReferences(ctx, request.ReferenceURLs)
	if err != nil {
		return generation.Response{}, err
	}
	defer cleanup()

	args := []string{"generate-video", "--prompt=" + request.Prompt}
	for _, item := range tempDir.media() {
		switch item.kind {
		case generation.KindAudio:
			args = append(args, "--audio="+item.path)
		case generation.KindVideo:
			args = append(args, "--video="+item.path)
		default:
			args = append(args, "--image="+item.path)
		}
	}
	appendIntFlag(&args, "duration", paramInt(request.Params, "duration", 0))
	appendStringFlag(&args, "ratio", paramString(request.Params, "ratio"))
	appendStringFlag(&args, "resolution", paramString(request.Params, "resolution"))
	appendStringFlag(&args, "model", firstNonEmpty(paramString(request.Params, "model"), request.Model))

	output, err := provider.runner.Run(ctx, provider.binPath, provider.env(), args...)
	if err != nil {
		return generation.Response{}, commandError("generate-video", output, err)
	}
	return parseGenerateVideoResponse(output, taskIDPrefix(request), request.Model)
}

// Get fetches async task status through pippit query-result.
func (provider *Provider) Get(ctx context.Context, id string) (generation.Response, error) {
	prefix, threadID, runID := splitProviderTaskID(id)
	if strings.TrimSpace(threadID) == "" || strings.TrimSpace(runID) == "" {
		return generation.Response{}, fmt.Errorf("pippit generation id must include thread_id and run_id")
	}

	downloadDir, err := os.MkdirTemp("", defaultQueryDownloadDir)
	if err != nil {
		return generation.Response{}, fmt.Errorf("creating pippit download temp dir: %w", err)
	}
	defer os.RemoveAll(downloadDir)

	output, err := provider.runner.Run(
		ctx,
		provider.binPath,
		provider.env(),
		"query-result",
		"--thread-id="+threadID,
		"--run-id="+runID,
		"--download-dir="+downloadDir,
	)
	if err != nil {
		return generation.Response{}, commandError("query-result", output, err)
	}
	return parseQueryResultResponse(output, prefix, threadID, runID)
}

func (provider *Provider) env() map[string]string {
	env := map[string]string{"XYQ_ACCESS_KEY": provider.apiKey}
	if provider.baseURL != "" {
		env["XYQ_OPENAPI_BASE"] = provider.baseURL
		env["XYQ_BASE_URL"] = provider.baseURL
	}
	return env
}

func parseGenerateVideoResponse(output []byte, prefix string, model string) (generation.Response, error) {
	payload, err := extractJSONObject(output)
	if err != nil {
		return generation.Response{}, err
	}
	threadID := stringFromMap(payload, "thread_id")
	runID := stringFromMap(payload, "run_id")
	if threadID == "" || runID == "" {
		return generation.Response{}, fmt.Errorf("pippit generate-video output missing thread_id or run_id")
	}
	return generation.Response{
		ID:     joinProviderTaskID(prefix, threadID, runID),
		Status: "submitted",
		Model:  model,
		Metadata: map[string]any{
			"result":          payload,
			"thread_id":       threadID,
			"run_id":          runID,
			"web_thread_link": stringFromMap(payload, "web_thread_link"),
		},
	}, nil
}

func parseQueryResultResponse(output []byte, prefix string, threadID string, runID string) (generation.Response, error) {
	payload, err := extractJSONObject(output)
	if err != nil {
		return generation.Response{}, err
	}
	completed := boolFromMap(payload, "completed")
	errorMessage := stringFromMap(payload, "error_message")
	response := generation.Response{
		ID:     joinProviderTaskID(prefix, firstNonEmpty(stringFromMap(payload, "thread_id"), threadID), firstNonEmpty(stringFromMap(payload, "run_id"), runID)),
		Status: "submitted",
		Assets: assetsFromQueryResult(payload),
		Metadata: map[string]any{
			"result":    payload,
			"thread_id": firstNonEmpty(stringFromMap(payload, "thread_id"), threadID),
			"run_id":    firstNonEmpty(stringFromMap(payload, "run_id"), runID),
		},
	}
	if completed {
		response.Status = "completed"
	}
	if errorMessage != "" {
		response.Status = "failed"
		response.Metadata["error"] = errorMessage
		response.Metadata["error_message"] = errorMessage
	}
	return response, nil
}

func assetsFromQueryResult(payload map[string]any) []generation.Asset {
	videos, ok := payload["videos"].([]any)
	if !ok || len(videos) == 0 {
		return nil
	}
	assets := make([]generation.Asset, 0, len(videos))
	for _, item := range videos {
		video, ok := item.(map[string]any)
		if !ok {
			continue
		}
		url := stringFromMap(video, "download_url")
		if url == "" {
			continue
		}
		metadata := map[string]any{}
		if outputPath := stringFromMap(video, "output_path"); outputPath != "" {
			metadata["output_path"] = outputPath
		}
		assets = append(assets, generation.Asset{
			Kind:     generation.KindVideo,
			URL:      url,
			MIMEType: "video/mp4",
			Metadata: metadata,
		})
	}
	return assets
}

func commandError(commandName string, output []byte, err error) error {
	message := strings.TrimSpace(string(output))
	if message == "" {
		return fmt.Errorf("pippit CLI %s failed: %w", commandName, err)
	}
	return fmt.Errorf("pippit CLI %s failed: %w: %s", commandName, err, message)
}

func extractJSONObject(output []byte) (map[string]any, error) {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return nil, errors.New("pippit CLI returned empty output")
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
	return nil, fmt.Errorf("pippit CLI output did not contain a JSON object: %s", truncate(text, 240))
}

// ResolveBinaryPath resolves an explicit binary, a vendored tools directory, or PATH.
func ResolveBinaryPath(explicitPath string, binDir string) (string, error) {
	binaryName := executableName(defaultBinaryName)
	if explicitPath = strings.TrimSpace(explicitPath); explicitPath != "" {
		return executableFile(explicitPath)
	}
	if binDir = strings.TrimSpace(binDir); binDir != "" {
		candidates := []string{
			filepath.Join(binDir, "pippit", binaryName),
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
		return "", fmt.Errorf("pippit CLI binary %q was not found", binaryName)
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
		return "", fmt.Errorf("resolving pippit CLI path %s: %w", path, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("pippit CLI path %s is a directory", resolved)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return "", fmt.Errorf("pippit CLI path %s is not executable", resolved)
	}
	return resolved, nil
}

type execCommandRunner struct{}

func (execCommandRunner) Run(ctx context.Context, path string, env map[string]string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, path, args...)
	command.Env = append(os.Environ(), envList(env)...)
	return command.CombinedOutput()
}

func envList(env map[string]string) []string {
	values := make([]string, 0, len(env))
	for key, value := range env {
		values = append(values, key+"="+value)
	}
	return values
}

type referenceFiles struct {
	dir   string
	files []referenceFile
}

type referenceFile struct {
	path string
	kind generation.Kind
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

	dir, err := os.MkdirTemp("", "mediago-pippit-ref-*")
	if err != nil {
		return referenceFiles{}, cleanup, fmt.Errorf("creating pippit reference temp dir: %w", err)
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
		extension := extensionForMediaType(mediaType)
		path := filepath.Join(dir, fmt.Sprintf("reference-%02d%s", index+1, extension))
		if err := os.WriteFile(path, decoded, 0o600); err != nil {
			return referenceFile{}, fmt.Errorf("writing pippit reference file: %w", err)
		}
		return referenceFile{path: path, kind: referenceKindForMediaType(mediaType)}, nil
	}
	if strings.HasPrefix(strings.ToLower(value), "http://") ||
		strings.HasPrefix(strings.ToLower(value), "https://") {
		mimeType, data, err := readHTTPReference(ctx, value)
		if err != nil {
			return referenceFile{}, fmt.Errorf("downloading pippit reference: %w", err)
		}
		path := filepath.Join(dir, fmt.Sprintf("reference-%02d%s", index+1, extensionForMediaType(firstNonEmpty(mimeType, value))))
		if err := os.WriteFile(path, data, 0o600); err != nil {
			return referenceFile{}, fmt.Errorf("writing pippit reference file: %w", err)
		}
		return referenceFile{path: path, kind: referenceKindForMediaType(firstNonEmpty(mimeType, value))}, nil
	}
	if strings.HasPrefix(strings.ToLower(value), "file://") {
		value = strings.TrimPrefix(value, "file://")
	}
	if filepath.IsAbs(value) {
		path, err := readableFile(value)
		if err != nil {
			return referenceFile{}, err
		}
		return referenceFile{path: path, kind: referenceKindForPath(path)}, nil
	}
	return referenceFile{}, fmt.Errorf("pippit CLI references must be local files, HTTP URLs, or data URIs")
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

func referenceKindForMediaType(mediaType string) generation.Kind {
	mediaType = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(mediaType)), "data:")
	mediaType, _, _ = strings.Cut(mediaType, ";")
	if strings.HasPrefix(mediaType, "audio/") {
		return generation.KindAudio
	}
	if strings.HasPrefix(mediaType, "video/") {
		return generation.KindVideo
	}
	return generation.KindImage
}

func referenceKindForPath(path string) generation.Kind {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".mp3", ".wav":
		return generation.KindAudio
	case ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mkv", ".m4v":
		return generation.KindVideo
	default:
		return generation.KindImage
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

func boolFromMap(values map[string]any, key string) bool {
	value, ok := values[key]
	if !ok || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true")
	default:
		return fmt.Sprint(typed) == "1"
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

func joinProviderTaskID(prefix string, threadID string, runID string) string {
	prefix = strings.TrimSpace(prefix)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	taskID := strings.Trim(threadID+":"+runID, ":")
	if prefix == "" {
		return taskID
	}
	if taskID == "" {
		return prefix
	}
	return prefix + ":" + taskID
}

func splitProviderTaskID(id string) (string, string, string) {
	prefix, taskID, ok := strings.Cut(strings.TrimSpace(id), ":")
	if !ok {
		return "", "", ""
	}
	threadID, runID, ok := strings.Cut(taskID, ":")
	if !ok {
		return prefix, taskID, ""
	}
	return prefix, strings.TrimSpace(threadID), strings.TrimSpace(runID)
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
