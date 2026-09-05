package generation

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
)

// GenerateCodexImage uses the image generation runtime installed with Codex.
func (workflow *GenerationService) GenerateCodexImage(ctx context.Context, projectID string, request CodexImageRequest) (CodexImageResponse, int, error) {
	projectID = GenerationProjectIDForRequest(projectID, "")
	request.Prompt = strings.TrimSpace(request.Prompt)
	request.ResourceID = strings.TrimSpace(request.ResourceID)
	request.ResourceTitle = strings.TrimSpace(request.ResourceTitle)
	request.ResourceType = strings.TrimSpace(request.ResourceType)
	if projectID == "" || request.Prompt == "" || request.ResourceID == "" || request.ResourceType == "" {
		return CodexImageResponse{}, http.StatusBadRequest, fmt.Errorf("缺少 Codex 生图所需的项目、Prompt 或资产信息")
	}
	if selectedGenerationResourceType(request.ResourceType) == "" {
		return CodexImageResponse{}, http.StatusBadRequest, fmt.Errorf("不支持的资产类型")
	}
	if workflow == nil || workflow.mediaAssets == nil {
		return CodexImageResponse{}, http.StatusServiceUnavailable, fmt.Errorf("资产库尚未就绪")
	}
	pythonPath, scriptPath, err := resolveCodexImageRuntime()
	if err != nil {
		return CodexImageResponse{}, http.StatusServiceUnavailable, err
	}

	workDir, err := os.MkdirTemp("", "mediago-codex-image-")
	if err != nil {
		return CodexImageResponse{}, http.StatusInternalServerError, err
	}
	defer os.RemoveAll(workDir)
	outputPath := filepath.Join(workDir, "asset.png")

	args := []string{scriptPath, "generate", "--prompt", request.Prompt, "--out", outputPath, "--size", "2048x1152", "--quality", "high", "--force"}
	if len(request.ReferenceURLs) > 0 {
		referencePaths, downloadErr := downloadCodexImageReferences(ctx, workDir, request.ReferenceURLs)
		if downloadErr != nil {
			return CodexImageResponse{}, http.StatusBadRequest, downloadErr
		}
		if len(referencePaths) > 0 {
			args[1] = "edit"
			for _, path := range referencePaths {
				args = append(args, "--image", path)
			}
		}
	}
	command := exec.CommandContext(ctx, pythonPath, args...)
	if output, commandErr := command.CombinedOutput(); commandErr != nil {
		return CodexImageResponse{}, http.StatusBadGateway, fmt.Errorf("Codex 生图失败：%s", strings.TrimSpace(string(output)))
	}
	file, err := os.Open(outputPath)
	if err != nil {
		return CodexImageResponse{}, http.StatusBadGateway, fmt.Errorf("Codex 未返回可归档的图片")
	}
	defer file.Close()
	filename := strings.TrimSpace(request.ResourceID) + "-codex.png"
	asset, err := workflow.mediaAssets.SaveReaderWithOptions(ctx, file, media.MediaKindImage, filename, "image/png", "codex:imagegen", media.MediaAssetSaveOptions{
		ProjectID: projectID,
		Source:    media.MediaSourceGeneration,
		Filename:  filename,
	})
	if err != nil {
		return CodexImageResponse{}, http.StatusInternalServerError, fmt.Errorf("图片已生成，但归档失败：%w", err)
	}
	selected := true
	selection, status, err := workflow.UpdateSelectedGenerationAsset(projectID, UpdateSelectedGenerationAssetRequest{
		Selected:      &selected,
		ResourceID:    request.ResourceID,
		ResourceTitle: request.ResourceTitle,
		ResourceType:  request.ResourceType,
		MediaAssetID:  asset.ID,
		Kind:          media.MediaKindImage,
		Title:         request.ResourceTitle,
		URL:           asset.URL,
		MIMEType:      asset.MIMEType,
		SourceType:    "generated",
		SourceKey:     "codex:imagegen",
		ShotIDs:       request.ShotIDs,
	})
	if err != nil {
		return CodexImageResponse{}, status, fmt.Errorf("图片已生成，但未能关联到资产卡：%w", err)
	}
	return CodexImageResponse{MediaAssetID: asset.ID, URL: asset.URL, Selected: selection.Asset}, http.StatusOK, nil
}

func resolveCodexImageRuntime() (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("无法定位 Windows 用户目录：%w", err)
	}
	pythonCandidates := []string{
		filepath.Join(home, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"),
		"python.exe",
		"python",
	}
	var pythonPath string
	for _, candidate := range pythonCandidates {
		if filepath.IsAbs(candidate) {
			if _, statErr := os.Stat(candidate); statErr == nil {
				pythonPath = candidate
				break
			}
			continue
		}
		if resolved, lookupErr := exec.LookPath(candidate); lookupErr == nil {
			pythonPath = resolved
			break
		}
	}
	scriptPath := filepath.Join(home, ".codex", "skills", ".system", "imagegen", "scripts", "image_gen.py")
	if pythonPath == "" {
		return "", "", fmt.Errorf("未找到 Codex 使用的 Windows Python 运行时")
	}
	if _, err := os.Stat(scriptPath); err != nil {
		return "", "", fmt.Errorf("未找到 Codex imagegen 技能：%s", scriptPath)
	}
	return pythonPath, scriptPath, nil
}

func downloadCodexImageReferences(ctx context.Context, workDir string, urls []string) ([]string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	paths := make([]string, 0, len(urls))
	for index, rawURL := range urls {
		if index >= 5 {
			break
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(rawURL), nil)
		if err != nil {
			return nil, fmt.Errorf("参考图地址无效：%w", err)
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("读取参考图失败：%w", err)
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			response.Body.Close()
			return nil, fmt.Errorf("读取参考图失败：HTTP %d", response.StatusCode)
		}
		path := filepath.Join(workDir, fmt.Sprintf("reference-%d.img", index+1))
		file, err := os.Create(path)
		if err == nil {
			_, err = file.ReadFrom(response.Body)
			_ = file.Close()
		}
		response.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("保存参考图失败：%w", err)
		}
		paths = append(paths, path)
	}
	return paths, nil
}
