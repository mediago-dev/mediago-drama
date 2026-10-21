package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// AgentBackend describes the bundled Codex runtime.
type AgentBackend struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Command     string `json:"command"`
	Description string `json:"description,omitempty"`
	IsBuiltin   bool   `json:"isBuiltin,omitempty"`
}

// AgentBackendsPayload identifies the sole supported backend.
type AgentBackendsPayload struct {
	Backends []AgentBackend `json:"backends"`
	ActiveID string         `json:"activeId"`
}

// AgentBackendService resolves the bundled native Codex executable.
type AgentBackendService struct{ binDir, command string }
type agentManifest struct {
	ID           string   `json:"id"`
	Bin          string   `json:"bin"`
	Args         []string `json:"args"`
	Version      string   `json:"version"`
	CodexBin     string   `json:"codexBin,omitempty"`
	CodexVersion string   `json:"codexVersion,omitempty"`
}

// NewAgentBackendService creates the native Codex backend.
func NewAgentBackendService(command string) *AgentBackendService {
	return NewAgentBackendServiceWithBinDir(command, "", "")
}

// NewAgentBackendServiceWithBinDir resolves Codex; stale backend selections use Codex.
func NewAgentBackendServiceWithBinDir(command, binDir, _ string) *AgentBackendService {
	return &AgentBackendService{command: strings.TrimSpace(command), binDir: strings.TrimSpace(binDir)}
}

// ListBackends returns the Codex backend descriptor.
func (s *AgentBackendService) ListBackends() AgentBackendsPayload {
	return AgentBackendsPayload{Backends: builtinAgentBackends(), ActiveID: "codex"}
}
func builtinAgentBackends() []AgentBackend {
	return []AgentBackend{{ID: "codex", Name: "Codex", Command: "codex app-server", Description: "原生 Codex app-server", IsBuiltin: true}}
}

// ActiveCommand returns the native executable path, without shell parsing.
func (s *AgentBackendService) ActiveCommand() string {
	path, err := s.CodexExecutable()
	if err != nil {
		return ""
	}
	return path
}

// ActiveArgv returns the executable used by the Codex runner.
func (s *AgentBackendService) ActiveArgv() []string { return []string{s.ActiveCommand()} }

// ActiveEnv returns explicit executable metadata for subprocess consumers.
func (s *AgentBackendService) ActiveEnv() map[string]string { return map[string]string{} }

// CodexExecutable resolves the vendored binary or an explicitly selected executable.
func (s *AgentBackendService) CodexExecutable() (string, error) {
	if s == nil {
		return "", fmt.Errorf("Codex backend is unavailable")
	}
	if s.command != "" {
		return exec.LookPath(s.command)
	}
	if s.binDir == "" {
		return exec.LookPath("codex")
	}
	manifest, err := loadAgentManifest(s.binDir, "codex")
	if err != nil {
		return "", err
	}
	name := manifest.CodexBin
	if name == "" {
		name = manifest.Bin
	}
	name, err = cleanAgentManifestPath(name)
	if err != nil {
		return "", err
	}
	base := strings.ToLower(filepath.Base(name))
	if base != "codex" && base != "codex.exe" {
		return "", fmt.Errorf("manifest must reference the native Codex executable")
	}
	path := filepath.Join(s.binDir, "codex", name)
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("checking Codex executable: %w", err)
	}
	if info.IsDir() || (runtime.GOOS != "windows" && info.Mode()&0o111 == 0) {
		return "", fmt.Errorf("Codex path is not executable")
	}
	return path, nil
}
func loadAgentManifest(binDir, id string) (agentManifest, error) {
	var manifest agentManifest
	if id != "codex" {
		return manifest, fmt.Errorf("only Codex is supported")
	}
	raw, err := os.ReadFile(filepath.Join(binDir, id, "agent.json"))
	if err != nil {
		return manifest, fmt.Errorf("reading Codex manifest: %w", err)
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return manifest, fmt.Errorf("decoding Codex manifest: %w", err)
	}
	for _, value := range []string{manifest.Bin, manifest.CodexBin} {
		if value != "" {
			if _, err := cleanAgentManifestPath(value); err != nil {
				return manifest, err
			}
		}
	}
	return manifest, nil
}
func cleanAgentManifestPath(value string) (string, error) {
	value = filepath.Clean(strings.ReplaceAll(strings.TrimSpace(value), "\\", string(filepath.Separator)))
	if value == "." || strings.HasPrefix(value, string(filepath.Separator)) || filepath.IsAbs(value) || value == ".." || strings.HasPrefix(value, ".."+string(filepath.Separator)) || strings.Contains(value, ":") {
		return "", fmt.Errorf("invalid Codex manifest path")
	}
	return value, nil
}
