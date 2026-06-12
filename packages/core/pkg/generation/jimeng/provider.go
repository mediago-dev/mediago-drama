// Package jimeng adapts the locally bundled Dreamina/Jimeng CLI to generation.
package jimeng

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	defaultBinaryName = "dreamina"
	defaultImagePoll  = 30
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

	output, err := provider.runner.Run(ctx, provider.binPath, "query_result", "--submit_id="+taskID)
	if err != nil {
		return generation.Response{}, commandError("query_result", output, err)
	}
	response, err := parseCLIResponse(output, generation.KindVideo, prefix, "")
	if err != nil {
		return generation.Response{}, err
	}
	if response.ID == "" {
		response.ID = joinTaskID(prefix, taskID)
	}
	return response, nil
}

func (provider *Provider) generateImage(ctx context.Context, request generation.Request) (generation.Response, error) {
	tempDir, cleanup, err := materializeReferences(request.ReferenceURLs)
	if err != nil {
		return generation.Response{}, err
	}
	defer cleanup()

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
	return parseCLIResponse(output, generation.KindImage, taskIDPrefix(request), request.Model)
}

func (provider *Provider) generateVideo(ctx context.Context, request generation.Request) (generation.Response, error) {
	tempDir, cleanup, err := materializeReferences(request.ReferenceURLs)
	if err != nil {
		return generation.Response{}, err
	}
	defer cleanup()

	modelVersion := firstNonEmpty(paramString(request.Params, "modelVersion"), request.Model)
	command := "text2video"
	args := []string{command}
	switch len(tempDir.paths) {
	case 0:
		args = append(args, "--prompt="+request.Prompt)
		appendStringFlag(&args, "duration", paramString(request.Params, "duration"))
		appendStringFlag(&args, "ratio", paramString(request.Params, "ratio"))
		appendStringFlag(&args, "video_resolution", paramString(request.Params, "videoResolution"))
		appendStringFlag(&args, "model_version", modelVersion)
	case 1:
		command = "image2video"
		args = []string{command, "--image=" + tempDir.paths[0]}
		args = append(args, "--prompt="+request.Prompt)
		appendStringFlag(&args, "duration", paramString(request.Params, "duration"))
		appendStringFlag(&args, "video_resolution", paramString(request.Params, "videoResolution"))
		appendStringFlag(&args, "model_version", modelVersion)
	default:
		command = "multimodal2video"
		args = []string{command}
		for _, path := range tempDir.paths {
			args = append(args, "--image="+path)
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
}

func materializeReferences(references []string) (referenceFiles, func(), error) {
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

	files := referenceFiles{dir: dir, paths: make([]string, 0, len(values))}
	for index, value := range values {
		path, err := materializeReference(dir, index, value)
		if err != nil {
			cleanup()
			return referenceFiles{}, func() {}, err
		}
		files.paths = append(files.paths, path)
	}
	return files, cleanup, nil
}

func materializeReference(dir string, index int, value string) (string, error) {
	if strings.HasPrefix(value, "data:") {
		mediaType, data, ok := strings.Cut(value, ",")
		if !ok {
			return "", fmt.Errorf("invalid data uri reference")
		}
		decoded, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			return "", fmt.Errorf("decoding data uri reference: %w", err)
		}
		extension := extensionForDataURI(mediaType)
		path := filepath.Join(dir, fmt.Sprintf("reference-%02d%s", index+1, extension))
		if err := os.WriteFile(path, decoded, 0o600); err != nil {
			return "", fmt.Errorf("writing jimeng reference file: %w", err)
		}
		return path, nil
	}
	if strings.HasPrefix(value, "file://") {
		value = strings.TrimPrefix(value, "file://")
	}
	if filepath.IsAbs(value) {
		return executableOrReadableFile(value)
	}
	return "", fmt.Errorf("jimeng CLI references must be local files or data URIs")
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

func extensionForDataURI(mediaType string) string {
	mediaType = strings.TrimPrefix(mediaType, "data:")
	mediaType, _, _ = strings.Cut(mediaType, ";")
	if mediaType == "" {
		return ".png"
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
