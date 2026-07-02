// Package libtv adapts the locally bundled LibTV CLI to generation.
package libtv

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
)

const (
	defaultBinaryName       = "libtv"
	defaultDownloadTempDir  = "mediago-libtv-result-*"
	defaultNodeNameTemplate = "mediago-%s-%d"
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

// Config controls the LibTV CLI provider.
type Config struct {
	BinPath   string
	BinDir    string
	ProjectID string
	Runner    CommandRunner
	Now       func() time.Time
}

// Provider calls the local LibTV CLI.
type Provider struct {
	binPath   string
	projectID string
	runner    CommandRunner
	now       func() time.Time
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
	return &Provider{
		binPath:   path,
		projectID: strings.TrimSpace(config.ProjectID),
		runner:    runner,
		now:       now,
	}, nil
}

// Name returns the provider name.
func (provider *Provider) Name() string {
	return "libtv-cli"
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
	if request.Kind != generation.KindVideo {
		return generation.Response{}, fmt.Errorf("libtv CLI currently supports video generation routes")
	}
	if len(compactStrings(request.ReferenceURLs)) > 0 {
		return generation.Response{}, fmt.Errorf("libtv CLI route does not support reference URLs yet")
	}

	projectID := firstNonEmpty(provider.projectID, paramString(request.Params, "projectId"), paramString(request.Params, "project_id"), paramString(request.Params, "project"))
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
	appendSetFlag(&args, "ratio", paramString(request.Params, "ratio"))
	appendSetFlag(&args, "resolution", paramString(request.Params, "resolution"))
	appendSetFlag(&args, "duration", paramString(request.Params, "duration"))
	appendSetFlag(&args, "enableSound", libTVEnableSoundValue(request.Params["enableSound"]))
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
		projectID = provider.projectID
	}

	downloadDir, err := os.MkdirTemp("", defaultDownloadTempDir)
	if err != nil {
		return generation.Response{}, fmt.Errorf("creating libtv download temp dir: %w", err)
	}
	defer os.RemoveAll(downloadDir)

	args := []string{"download", "--node=" + node, "--out=" + downloadDir, "--without-ai-watermark"}
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

func appendSetFlag(args *[]string, name string, value string) {
	value = strings.TrimSpace(value)
	if value != "" {
		*args = append(*args, "--set="+name+"="+value)
	}
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
		assets = append(assets, generation.Asset{
			Kind:     kindForMIMEType(mimeType),
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

func kindForMIMEType(mimeType string) generation.Kind {
	if strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return generation.KindImage
	}
	if strings.HasPrefix(strings.ToLower(mimeType), "audio/") {
		return generation.KindAudio
	}
	return generation.KindVideo
}

func commandError(commandName string, output []byte, err error) error {
	message := strings.TrimSpace(string(output))
	if message == "" {
		return fmt.Errorf("libtv CLI %s failed: %w", commandName, err)
	}
	return fmt.Errorf("libtv CLI %s failed: %w: %s", commandName, err, message)
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
