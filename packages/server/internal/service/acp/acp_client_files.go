package acp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	acp "github.com/coder/acp-go-sdk"
)

func (client *acpClient) ReadTextFile(_ context.Context, params acp.ReadTextFileRequest) (acp.ReadTextFileResponse, error) {
	path, err := client.workspacePath(params.Path)
	if err != nil {
		acpLog().Warn("acp read file denied", client.logAttrs("path", params.Path, "error", err)...)
		return acp.ReadTextFileResponse{}, err
	}
	acpLog().Debug("acp read file", client.logAttrs("path", client.displayPath(path), "line", OptionalInt(params.Line), "limit", OptionalInt(params.Limit))...)
	client.flushThoughts()
	client.publish(agentEvent{
		Type:    "agent.activity",
		Message: "读取文件：" + client.displayPath(path),
	})
	content, err := os.ReadFile(path)
	if err != nil {
		acpLog().Error("acp read file failed", client.logAttrs("path", client.displayPath(path), "error", err)...)
		return acp.ReadTextFileResponse{}, err
	}

	value := string(content)
	if params.Line != nil || params.Limit != nil {
		lines := strings.Split(value, "\n")
		start := 0
		if params.Line != nil && *params.Line > 0 {
			start = min(*params.Line-1, len(lines))
		}
		end := len(lines)
		if params.Limit != nil && *params.Limit > 0 && start+*params.Limit < end {
			end = start + *params.Limit
		}
		value = strings.Join(lines[start:end], "\n")
	}

	acpLog().Debug("acp read file completed", client.logAttrs("path", client.displayPath(path), "bytes", len(value))...)
	return acp.ReadTextFileResponse{Content: value}, nil
}

func (client *acpClient) WriteTextFile(_ context.Context, params acp.WriteTextFileRequest) (acp.WriteTextFileResponse, error) {
	path, err := client.workspacePath(params.Path)
	if err != nil {
		acpLog().Warn("acp write file denied", client.logAttrs("path", params.Path, "error", err)...)
		return acp.WriteTextFileResponse{}, err
	}
	acpLog().Debug("acp write file", client.logAttrs("path", client.displayPath(path), "bytes", len(params.Content))...)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		acpLog().Error("acp write file mkdir failed", client.logAttrs("path", client.displayPath(path), "error", err)...)
		return acp.WriteTextFileResponse{}, err
	}
	if err := os.WriteFile(path, []byte(params.Content), 0o644); err != nil {
		acpLog().Error("acp write file failed", client.logAttrs("path", client.displayPath(path), "error", err)...)
		return acp.WriteTextFileResponse{}, err
	}
	client.flushThoughts()
	client.publish(agentEvent{
		Type:    "agent.activity",
		Message: "已写入文件：" + client.displayPath(path),
	})
	acpLog().Debug("acp write file completed", client.logAttrs("path", client.displayPath(path), "bytes", len(params.Content))...)
	return acp.WriteTextFileResponse{}, nil
}

func (client *acpClient) workspacePath(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("path must be absolute: %s", path)
	}
	cleanPath := filepath.Clean(path)
	root := filepath.Clean(client.workspaceDir)
	if root == "" || root == "." {
		return cleanPath, nil
	}
	relative, err := filepath.Rel(root, cleanPath)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) || filepath.IsAbs(relative) {
		return "", fmt.Errorf("path outside workspace: %s", path)
	}
	return cleanPath, nil
}

func (client *acpClient) displayPath(path string) string {
	root := filepath.Clean(client.workspaceDir)
	if root == "" || root == "." {
		return path
	}
	relative, err := filepath.Rel(root, path)
	if err == nil && relative != "." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && !filepath.IsAbs(relative) {
		return filepath.ToSlash(relative)
	}
	return path
}
