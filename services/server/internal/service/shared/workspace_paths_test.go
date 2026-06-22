package shared

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
)

func TestResolveWorkspaceDirUsesAppDataWorkspaceByDefault(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(homeDir, ".config"))
	t.Setenv("APPDATA", filepath.Join(homeDir, "AppData", "Roaming"))

	configDir, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("UserConfigDir() error = %v", err)
	}

	got := ResolveWorkspaceDir("")
	want := filepath.Join(configDir, userDataDirName, "workspace")
	if got != want {
		t.Fatalf("ResolveWorkspaceDir(empty) = %q, want %q", got, want)
	}
	if filepath.Base(filepath.Dir(filepath.Dir(got))) == "Documents" {
		t.Fatalf("ResolveWorkspaceDir(empty) = %q, should not default under Documents", got)
	}
}

func TestDefaultUserDataDirUsesUserConfigDir(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(homeDir, ".config"))
	t.Setenv("APPDATA", filepath.Join(homeDir, "AppData", "Roaming"))

	configDir, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("UserConfigDir() error = %v", err)
	}

	got := DefaultUserDataDir()
	want := filepath.Join(configDir, userDataDirName)
	if got != want {
		t.Fatalf("DefaultUserDataDir() = %q, want %q", got, want)
	}
}

func TestDefaultUserDataDirFallsBackToWorkingDirectory(t *testing.T) {
	cwd := t.TempDir()
	t.Chdir(cwd)
	t.Setenv("HOME", "")
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("APPDATA", "")

	got := DefaultUserDataDir()
	want := filepath.Join(cwd, metadataDirName)
	if got != want {
		t.Fatalf("DefaultUserDataDir() = %q, want %q", got, want)
	}
}

func TestResolveWorkspaceDirExpandsHomePath(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	got := ResolveWorkspaceDir("~/MediaGo Workspace")
	want := filepath.Join(homeDir, "MediaGo Workspace")
	if got != want {
		t.Fatalf("ResolveWorkspaceDir(home path) = %q, want %q", got, want)
	}
}

func TestWorkspacePathsGlobalProjectAndStudioDirs(t *testing.T) {
	root := t.TempDir()
	paths := WorkspacePathsFor(root)

	tests := []struct {
		name string
		got  string
		want string
	}{
		{
			name: "agent root",
			got:  paths.AgentDir(""),
			want: filepath.Join(root, "projects"),
		},
		{
			name: "agent project",
			got:  paths.AgentDir("project-1"),
			want: filepath.Join(root, "projects", "project-1"),
		},
		{
			name: "studio session",
			got:  paths.StudioSessionDir("conversation-1"),
			want: filepath.Join(root, ".mediago-drama", "toolbox", "conversation-1"),
		},
		{
			name: "studio capability run",
			got:  paths.StudioRunDir("video.chunk", "run-1", "2026-06-06T12:00:00Z"),
			want: filepath.Join(root, ".mediago-drama", "toolbox", "video-chunk", "2026-06", "run-1"),
		},
		{
			name: "studio generation session",
			got:  paths.StudioGenerationSessionDir("text", "conversation-1", "2026-06-06T12:00:00Z"),
			want: filepath.Join(root, ".mediago-drama", "toolbox", "text-generation", "2026-06", "conversation-1"),
		},
		{
			name: "media poster cache",
			got:  paths.MediaPosterCacheDir(),
			want: filepath.Join(root, ".mediago-drama", "cache", "media-posters"),
		},
		{
			name: "workspace database",
			got:  paths.DatabasePath(),
			want: filepath.Join(root, ".mediago-drama", "db", "app.db"),
		},
		{
			name: "workspace settings database",
			got:  paths.SettingsDatabasePath(),
			want: filepath.Join(root, ".mediago-drama", "db", "settings.db"),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.got != test.want {
				t.Fatalf("path = %q, want %q", test.got, test.want)
			}
		})
	}
}

func TestEnsureWorkspaceLayoutMigratesVisibleToolboxToMetadata(t *testing.T) {
	root := t.TempDir()
	oldTranscriptPath := filepath.Join(root, "toolbox", "text-generation", "2026-06", "session-1", "transcript.jsonl")
	if err := os.MkdirAll(filepath.Dir(oldTranscriptPath), 0o755); err != nil {
		t.Fatalf("creating legacy toolbox dir: %v", err)
	}
	if err := os.WriteFile(oldTranscriptPath, []byte(`{"role":"assistant"}`+"\n"), 0o600); err != nil {
		t.Fatalf("writing legacy transcript: %v", err)
	}

	if err := EnsureWorkspaceLayout(root); err != nil {
		t.Fatal(err)
	}

	newTranscriptPath := filepath.Join(root, ".mediago-drama", "toolbox", "text-generation", "2026-06", "session-1", "transcript.jsonl")
	if _, err := os.Stat(newTranscriptPath); err != nil {
		t.Fatalf("transcript should be migrated to metadata toolbox: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "toolbox")); !os.IsNotExist(err) {
		t.Fatalf("visible toolbox should be removed after migration, err=%v", err)
	}

	var workspaceConfig WorkspaceConfigFile
	configData, err := os.ReadFile(filepath.Join(root, ".mediago-drama", "config", "workspace.json"))
	if err != nil {
		t.Fatalf("reading workspace config: %v", err)
	}
	if err := json.Unmarshal(configData, &workspaceConfig); err != nil {
		t.Fatalf("decoding workspace config: %v", err)
	}
	if got, want := workspaceConfig.SettingsDatabasePath, WorkspacePathsFor(root).SettingsDatabasePath(); got != want {
		t.Fatalf("settingsDatabasePath = %q, want %q", got, want)
	}
}

func TestEnsureProjectLayoutCreatesMinimalVisibleProjectTree(t *testing.T) {
	root := t.TempDir()
	projectDir := filepath.Join(t.TempDir(), "external-project")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	project := mediamcp.Project{
		ID:          "project-minimal",
		Name:        "第一集：开场",
		Description: "测试项目目录。",
		ProjectDir:  projectDir,
		CreatedAt:   "2026-05-18T00:00:00Z",
		UpdatedAt:   "2026-05-18T00:00:00Z",
	}

	if err := EnsureProjectLayout(root, project); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		filepath.Join(projectDir, "work"),
		filepath.Join(projectDir, "library"),
		filepath.Join(projectDir, "project.media.json"),
		filepath.Join(projectDir, "README.md"),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("path %s should exist: %v", path, err)
		}
	}

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		t.Fatalf("reading project dir: %v", err)
	}
	got := map[string]bool{}
	for _, entry := range entries {
		got[entry.Name()] = true
	}
	want := map[string]bool{
		"library":            true,
		"work":               true,
		"project.media.json": true,
		"README.md":          true,
	}
	if len(got) != len(want) {
		t.Fatalf("project dir entries = %#v, want %#v", got, want)
	}
	for name := range want {
		if !got[name] {
			t.Fatalf("project dir entries = %#v, missing %s", got, name)
		}
	}

	for _, path := range []string{
		filepath.Join(projectDir, "assets", "raw"),
		filepath.Join(projectDir, "docs", "notes"),
		filepath.Join(projectDir, "library", "assets", "images"),
		filepath.Join(projectDir, "library", "assets", "video"),
		filepath.Join(projectDir, "library", "assets", "audio"),
		filepath.Join(projectDir, "library", "assets", "text"),
		filepath.Join(projectDir, "logs"),
		filepath.Join(projectDir, "canvases", "main.canvas.json"),
		filepath.Join(projectDir, "workbenches", "clips", "episode-01.clip.json"),
		filepath.Join(projectDir, "agents", "runs"),
		filepath.Join(projectDir, "output", "final"),
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("path %s should not exist, err=%v", path, err)
		}
	}

	var manifest ProjectManifestFile
	data, err := os.ReadFile(filepath.Join(projectDir, "project.media.json"))
	if err != nil {
		t.Fatalf("reading project manifest: %v", err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("decoding project manifest: %v", err)
	}
	rawManifest := map[string]any{}
	if err := json.Unmarshal(data, &rawManifest); err != nil {
		t.Fatalf("decoding raw project manifest: %v", err)
	}
	if _, ok := rawManifest["category"]; ok {
		t.Fatalf("manifest should not include project category: %s", string(data))
	}
	if _, ok := rawManifest["directories"]; ok {
		t.Fatalf("manifest should not include directories: %s", string(data))
	}
	if _, ok := rawManifest["updatedAt"]; ok {
		t.Fatalf("manifest should not include updatedAt: %s", string(data))
	}
	if manifest.SchemaVersion != 1 ||
		manifest.ProjectID != project.ID ||
		manifest.Name != project.Name ||
		manifest.Description != project.Description ||
		manifest.CreatedAt != project.CreatedAt ||
		manifest.Overview.Style != "" {
		t.Fatalf("manifest = %#v, want minimal v1 project config", manifest)
	}
}

func TestEnsureProjectLayoutNormalizesExistingProjectManifest(t *testing.T) {
	root := t.TempDir()
	projectDir := filepath.Join(t.TempDir(), "external-project")
	if err := os.MkdirAll(projectDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(projectDir, "project.media.json"),
		[]byte(`{"schemaVersion":1,"projectId":"old","name":"旧名","description":"旧描述","directories":{"work":"work"},"overview":{"style":"冷调写实"},"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"}`),
		0o644,
	); err != nil {
		t.Fatalf("writing existing manifest: %v", err)
	}
	project := mediamcp.Project{
		ID:          "project-normalized",
		Name:        "新项目",
		Description: "新描述",
		ProjectDir:  projectDir,
		CreatedAt:   "2026-05-18T00:00:00Z",
	}

	if err := EnsureProjectLayout(root, project); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(projectDir, "project.media.json"))
	if err != nil {
		t.Fatalf("reading project manifest: %v", err)
	}
	rawManifest := map[string]any{}
	if err := json.Unmarshal(data, &rawManifest); err != nil {
		t.Fatalf("decoding raw project manifest: %v", err)
	}
	if _, ok := rawManifest["directories"]; ok {
		t.Fatalf("manifest should not include directories: %s", string(data))
	}
	if _, ok := rawManifest["updatedAt"]; ok {
		t.Fatalf("manifest should not include updatedAt: %s", string(data))
	}

	var manifest ProjectManifestFile
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatalf("decoding project manifest: %v", err)
	}
	if manifest.ProjectID != project.ID ||
		manifest.Name != project.Name ||
		manifest.Description != project.Description ||
		manifest.Overview.Style != "冷调写实" ||
		manifest.CreatedAt != "2026-01-01T00:00:00Z" {
		t.Fatalf("manifest = %#v, want normalized manifest preserving overview style and createdAt", manifest)
	}
}
