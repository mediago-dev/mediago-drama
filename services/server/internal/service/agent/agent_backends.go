package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	defaultAgentBackendID      = "codex"
	defaultAgentBackendCommand = "codex-acp"
	customAgentBackendID       = "custom"
)

// AgentBackend describes one configured ACP-compatible agent backend.
type AgentBackend struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Command     string `json:"command"`
	Description string `json:"description,omitempty"`
	IsBuiltin   bool   `json:"isBuiltin,omitempty"`
}

// AgentBackendsPayload is returned by the configured agent backend API.
type AgentBackendsPayload struct {
	Backends []AgentBackend `json:"backends"`
	ActiveID string         `json:"activeId"`
}

// AgentBackendService keeps the configured ACP backends and active backend in memory.
type AgentBackendService struct {
	mu       sync.RWMutex
	backends []AgentBackend
	activeID string
	binDir   string
}

type agentManifest struct {
	ID           string   `json:"id"`
	Bin          string   `json:"bin"`
	Args         []string `json:"args"`
	Version      string   `json:"version"`
	CodexBin     string   `json:"codexBin,omitempty"`
	CodexVersion string   `json:"codexVersion,omitempty"`
}

// NewAgentBackendService creates an in-memory service for the configured ACP backend.
func NewAgentBackendService(initialCommand string) *AgentBackendService {
	return NewAgentBackendServiceWithBinDir(initialCommand, "", "")
}

// NewAgentBackendServiceWithBinDir creates a backend service with optional vendored binaries.
func NewAgentBackendServiceWithBinDir(initialCommand string, binDir string, activeBackendID string) *AgentBackendService {
	backends := builtinAgentBackends()
	activeID := defaultAgentBackendID
	command := normalizeAgentBackendCommand(initialCommand)
	if command != "" {
		for _, backend := range backends {
			if normalizeAgentBackendCommand(backend.Command) == command {
				activeID = backend.ID
				return newAgentBackendService(backends, activeID, binDir, activeBackendID)
			}
		}

		backends = append(backends, AgentBackend{
			ID:          customAgentBackendID,
			Name:        "Custom",
			Command:     command,
			Description: "通过 --acp-command 提供的自定义 ACP 后端。",
			IsBuiltin:   false,
		})
		activeID = customAgentBackendID
	}

	return newAgentBackendService(backends, activeID, binDir, activeBackendID)
}

// ListBackends returns a snapshot of configured backends and the active id.
func (store *AgentBackendService) ListBackends() AgentBackendsPayload {
	if store == nil {
		return AgentBackendsPayload{
			Backends: builtinAgentBackends(),
			ActiveID: defaultAgentBackendID,
		}
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	backends := make([]AgentBackend, len(store.backends))
	copy(backends, store.backends)
	activeID := store.activeID
	if activeID == "" {
		activeID = defaultAgentBackendID
	}
	return AgentBackendsPayload{
		Backends: backends,
		ActiveID: activeID,
	}
}

// ActiveCommand returns the command for the active backend.
func (store *AgentBackendService) ActiveCommand() string {
	if store == nil {
		return defaultAgentBackendCommand
	}

	store.mu.RLock()
	defer store.mu.RUnlock()

	return store.activeCommandLocked()
}

// ActiveArgv returns the executable argv for the active backend.
func (store *AgentBackendService) ActiveArgv() []string {
	if store == nil {
		return splitAgentBackendCommand(defaultAgentBackendCommand)
	}

	store.mu.RLock()
	activeID := store.activeID
	binDir := store.binDir
	command := store.activeCommandLocked()
	store.mu.RUnlock()

	if strings.TrimSpace(binDir) != "" && strings.TrimSpace(activeID) != "" {
		if manifest, err := loadAgentManifest(binDir, activeID); err == nil {
			if argv := manifestArgv(binDir, activeID, manifest); len(argv) > 0 {
				return argv
			}
		}
	}

	return splitAgentBackendCommand(command)
}

// ActiveEnv returns environment variables required by the active vendored backend.
func (store *AgentBackendService) ActiveEnv() map[string]string {
	if store == nil {
		return map[string]string{}
	}

	store.mu.RLock()
	activeID := store.activeID
	binDir := store.binDir
	store.mu.RUnlock()
	if strings.TrimSpace(binDir) == "" || strings.TrimSpace(activeID) == "" {
		return map[string]string{}
	}
	manifest, err := loadAgentManifest(binDir, activeID)
	if err != nil || manifest.CodexBin == "" {
		return map[string]string{}
	}
	return map[string]string{
		"CODEX_PATH": filepath.Join(binDir, activeID, manifest.CodexBin),
	}
}

func (store *AgentBackendService) activeCommandLocked() string {
	for _, backend := range store.backends {
		if backend.ID == store.activeID {
			command := strings.TrimSpace(backend.Command)
			if command != "" {
				return command
			}
			break
		}
	}
	return defaultAgentBackendCommand
}

func builtinAgentBackends() []AgentBackend {
	return []AgentBackend{
		{
			ID:          defaultAgentBackendID,
			Name:        "Codex",
			Command:     defaultAgentBackendCommand,
			Description: "默认 Codex ACP 后端。",
			IsBuiltin:   true,
		},
		{
			ID:          "opencode",
			Name:        "OpenCode",
			Command:     "opencode acp",
			Description: "OpenCode ACP 后端。",
			IsBuiltin:   true,
		},
	}
}

func newAgentBackendService(backends []AgentBackend, activeID string, binDir string, requestedActiveID string) *AgentBackendService {
	requestedActiveID = strings.TrimSpace(requestedActiveID)
	if requestedActiveID != "" {
		for _, backend := range backends {
			if backend.ID == requestedActiveID {
				activeID = requestedActiveID
				break
			}
		}
	}

	return &AgentBackendService{
		backends: backends,
		activeID: activeID,
		binDir:   strings.TrimSpace(binDir),
	}
}

func loadAgentManifest(binDir string, id string) (agentManifest, error) {
	binDir = strings.TrimSpace(binDir)
	id = strings.TrimSpace(id)
	if binDir == "" {
		return agentManifest{}, fmt.Errorf("agent bin dir is empty")
	}
	if id == "" {
		return agentManifest{}, fmt.Errorf("agent id is empty")
	}

	path := filepath.Join(binDir, id, "agent.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return agentManifest{}, fmt.Errorf("reading agent manifest %s: %w", path, err)
	}

	var manifest agentManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return agentManifest{}, fmt.Errorf("parsing agent manifest %s: %w", path, err)
	}
	manifest.ID = strings.TrimSpace(manifest.ID)
	manifest.Bin = strings.TrimSpace(manifest.Bin)
	manifest.Version = strings.TrimSpace(manifest.Version)
	manifest.CodexBin = strings.TrimSpace(manifest.CodexBin)
	manifest.CodexVersion = strings.TrimSpace(manifest.CodexVersion)
	for index := range manifest.Args {
		manifest.Args[index] = strings.TrimSpace(manifest.Args[index])
	}
	if manifest.ID != "" && manifest.ID != id {
		return agentManifest{}, fmt.Errorf("agent manifest %s has id %q, want %q", path, manifest.ID, id)
	}
	if manifest.Bin == "" {
		return agentManifest{}, fmt.Errorf("agent manifest %s has empty bin", path)
	}
	manifest.Bin, err = cleanAgentManifestPath(manifest.Bin)
	if err != nil {
		return agentManifest{}, fmt.Errorf("agent manifest %s bin: %w", path, err)
	}
	if manifest.CodexBin != "" {
		manifest.CodexBin, err = cleanAgentManifestPath(manifest.CodexBin)
		if err != nil {
			return agentManifest{}, fmt.Errorf("agent manifest %s codexBin: %w", path, err)
		}
	}
	return manifest, nil
}

func cleanAgentManifestPath(value string) (string, error) {
	cleaned := filepath.Clean(strings.TrimSpace(value))
	if cleaned == "" || cleaned == "." || filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("must be a relative path inside the agent directory")
	}
	return cleaned, nil
}

func manifestArgv(binDir string, id string, manifest agentManifest) []string {
	bin := strings.TrimSpace(manifest.Bin)
	if bin == "" {
		return nil
	}

	argv := []string{filepath.Join(binDir, id, bin)}
	for _, arg := range manifest.Args {
		if arg != "" {
			argv = append(argv, arg)
		}
	}
	return argv
}

func normalizeAgentBackendCommand(command string) string {
	return strings.Join(strings.Fields(command), " ")
}

func splitAgentBackendCommand(command string) []string {
	parts := strings.Fields(command)
	if len(parts) == 0 {
		return []string{defaultAgentBackendCommand}
	}
	return parts
}
