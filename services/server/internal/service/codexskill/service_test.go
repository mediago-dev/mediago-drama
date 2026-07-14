package codexskill

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestServiceDiscoversGlobalRootsAndDirectChildren(t *testing.T) {
	home := t.TempDir()
	codexHome := filepath.Join(home, "custom-codex")
	adminRoot := filepath.Join(home, "admin-skills")
	writeSkillFixture(t, filepath.Join(home, ".agents", "skills", "shared"), "shared", "Shared skill")
	writeSkillFixture(t, filepath.Join(codexHome, "skills", "legacy"), "legacy", "Codex home skill")
	writeSkillFixture(t, filepath.Join(codexHome, "skills", ".system", "builtin"), "builtin", "Built-in skill")
	writeSkillFixture(t, filepath.Join(adminRoot, "managed"), "managed", "Managed skill")
	writeSkillFixture(t, filepath.Join(home, ".agents", "skills", "nested", "ignored"), "ignored", "Nested skill")
	if err := os.MkdirAll(filepath.Join(home, ".agents", "skills", "missing-skill"), 0o755); err != nil {
		t.Fatalf("creating invalid skill directory: %v", err)
	}

	service := NewServiceWithOptions(t.TempDir(), ServiceOptions{
		HomeDir: func() (string, error) { return home, nil },
		LookupEnv: func(name string) (string, bool) {
			if name == "CODEX_HOME" {
				return codexHome, true
			}
			return "", false
		},
		AdminRoots: []string{adminRoot},
		Now:        func() time.Time { return time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC) },
	})

	result, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if result.GeneratedAt != "2026-07-14T12:00:00Z" {
		t.Fatalf("generatedAt = %q", result.GeneratedAt)
	}
	if result.Summary.Total != 5 {
		t.Fatalf("skills = %#v, want 5 recursive skills", result.Skills)
	}
	assertSources(t, result.Skills, map[Source]int{
		SourceUserShared: 2,
		SourceCodexHome:  1,
		SourceSystem:     1,
		SourceAdmin:      1,
	})
	if nested := findSkillByName(t, result.Skills, "ignored"); nested.Name != "ignored" {
		t.Fatalf("nested skill should be discovered: %#v", nested)
	}
	if len(result.Roots) != 4 {
		t.Fatalf("roots = %#v, want user, codex, system and admin", result.Roots)
	}
}

func TestServiceReportsMissingAndUnreadableRootsWithoutFailing(t *testing.T) {
	home := t.TempDir()
	unreadableRoot := filepath.Join(home, "unreadable")
	writeTestFile(t, unreadableRoot, "not a directory")
	service := NewServiceWithOptions(t.TempDir(), ServiceOptions{
		HomeDir:   func() (string, error) { return home, nil },
		LookupEnv: func(string) (string, bool) { return "", false },
		AdminRoots: []string{
			filepath.Join(home, "missing"),
			unreadableRoot,
		},
	})

	result, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(result.Issues) != 1 || result.Issues[0].Code != IssueRootUnreadable {
		t.Fatalf("issues = %#v, want one unreadable root issue", result.Issues)
	}
	var foundUnreadable bool
	for _, root := range result.Roots {
		if root.Source == SourceAdmin && root.DisplayPath == "$ADMIN_SKILLS/2" {
			foundUnreadable = root.Exists && !root.Readable && root.Error != ""
		}
	}
	if !foundUnreadable {
		t.Fatalf("roots = %#v, want unreadable root diagnostic", result.Roots)
	}
}

func TestServiceKeepsSymlinkEntryIdentityAndDuplicateNames(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink behavior differs on Windows")
	}
	home := t.TempDir()
	target := filepath.Join(home, "target")
	writeSkillFixture(t, target, "duplicate-name", "Shared target")
	userEntry := filepath.Join(home, ".agents", "skills", "linked")
	codexEntry := filepath.Join(home, ".codex", "skills", "linked")
	for _, entry := range []string{userEntry, codexEntry} {
		if err := os.MkdirAll(filepath.Dir(entry), 0o755); err != nil {
			t.Fatalf("creating symlink parent: %v", err)
		}
		if err := os.Symlink(target, entry); err != nil {
			t.Fatalf("creating symlink: %v", err)
		}
	}

	service := testService(home)
	first, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("first List returned error: %v", err)
	}
	second, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("second List returned error: %v", err)
	}
	if len(first.Skills) != 1 || len(second.Skills) != 1 {
		t.Fatalf("skills = %#v, want one physically deduplicated entry", first.Skills)
	}
	ids := map[string]bool{first.Skills[0].ID: true}
	for _, skill := range second.Skills {
		if !ids[skill.ID] {
			t.Fatalf("id %q is not stable across scans", skill.ID)
		}
	}
	for _, skill := range first.Skills {
		if !skill.Linked || skill.SameNameCount != 1 || skill.SamePhysicalCount != 2 || skill.AliasCount != 2 || len(skill.Origins) != 2 {
			t.Fatalf("skill = %#v, want linked duplicate diagnostics", skill)
		}
	}
	detail, err := service.Get(context.Background(), first.Skills[0].ID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	wantResolved, err := filepath.EvalSymlinks(filepath.Join(target, "SKILL.md"))
	if err != nil {
		t.Fatalf("resolving expected target: %v", err)
	}
	if detail.ResolvedPath != wantResolved {
		t.Fatalf("resolvedPath = %q, want %q", detail.ResolvedPath, wantResolved)
	}
}

func TestServiceAppliesHostAndRuntimeSkillConfig(t *testing.T) {
	home := t.TempDir()
	hostHome := filepath.Join(home, ".codex")
	runtimeHome := filepath.Join(home, "runtime-codex")
	sharedDir := filepath.Join(home, ".agents", "skills", "shared")
	legacyDir := filepath.Join(hostHome, "skills", "legacy")
	writeSkillFixture(t, sharedDir, "shared", "Shared skill")
	writeSkillFixture(t, legacyDir, "legacy", "Legacy skill")
	writeTestFile(t, filepath.Join(hostHome, "config.toml"), "[[skills.config]]\npath = \""+filepath.ToSlash(filepath.Join(sharedDir, "SKILL.md"))+"\"\nenabled = false\n\n[[skills.config]]\npath = \""+filepath.ToSlash(legacyDir)+"\"\nenabled = true\n")
	writeTestFile(t, filepath.Join(runtimeHome, "config.toml"), "[[skills.config]]\npath = \""+filepath.ToSlash(sharedDir)+"\"\nenabled = false\n")

	service := NewServiceWithOptions(t.TempDir(), ServiceOptions{
		HomeDir:   func() (string, error) { return home, nil },
		LookupEnv: func(string) (string, bool) { return "", false },
		RuntimeHome: func(context.Context) (RuntimeHomeDescriptor, error) {
			return RuntimeHomeDescriptor{CodexHome: runtimeHome, Isolated: true}, nil
		},
		AdminRoots: []string{},
	})
	result, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	shared := findSkillByName(t, result.Skills, "shared")
	if shared.AppCLI.State != AvailabilityDisabled || shared.MediaGo.State != AvailabilityAvailable {
		t.Fatalf("shared diagnostics = app:%#v mediaGo:%#v", shared.AppCLI, shared.MediaGo)
	}
	legacy := findSkillByName(t, result.Skills, "legacy")
	if legacy.AppCLI.State != AvailabilityAvailable || legacy.MediaGo.State != AvailabilityNotShared {
		t.Fatalf("legacy diagnostics = app:%#v mediaGo:%#v", legacy.AppCLI, legacy.MediaGo)
	}
}

func TestServiceAppliesNameRulesLastMatchAndBundledSetting(t *testing.T) {
	home := t.TempDir()
	userRoot := filepath.Join(home, ".agents", "skills")
	hostHome := filepath.Join(home, ".codex")
	nameDir := filepath.Join(userRoot, "by-name")
	pathDir := filepath.Join(userRoot, "by-path")
	writeSkillFixture(t, nameDir, "by-name", "Name selector")
	writeSkillFixture(t, pathDir, "by-path", "Path selector")
	writeSkillFixture(t, filepath.Join(hostHome, "skills", ".system", "builtin"), "builtin", "Bundled selector")
	config := strings.Join([]string{
		"[[skills.config]]",
		`name = "by-name"`,
		"enabled = false",
		"[[skills.config]]",
		`name = "by-name"`,
		"enabled = true",
		"[[skills.config]]",
		`path = "` + filepath.ToSlash(filepath.Join(pathDir, "SKILL.md")) + `"`,
		"enabled = false",
		"[[skills.config]]",
		`path = "` + filepath.ToSlash(nameDir) + `"`,
		"enabled = false",
		"[[skills.config]]",
		`path = "` + filepath.ToSlash(nameDir) + `"`,
		`name = "by-name"`,
		"enabled = false",
		"[[skills.config]]",
		"enabled = false",
		"[skills.bundled]",
		"enabled = false",
	}, "\n")
	writeTestFile(t, filepath.Join(hostHome, "config.toml"), config)

	result, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if got := findSkillByName(t, result.Skills, "by-name").AppCLI; got.State != AvailabilityAvailable {
		t.Fatalf("by-name app diagnostic = %#v, want last matching enable", got)
	}
	if got := findSkillByName(t, result.Skills, "by-path").AppCLI; got.State != AvailabilityDisabled || got.ReasonCode != ReasonDisabledByConfig {
		t.Fatalf("by-path app diagnostic = %#v, want path disable", got)
	}
	if got := findSkillByName(t, result.Skills, "builtin").AppCLI; got.State != AvailabilityDisabled || got.ReasonCode != ReasonBundledDisabled {
		t.Fatalf("builtin app diagnostic = %#v, want bundled disable", got)
	}
}

func TestServiceProductPolicyRestrictsMediaGoOnly(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".agents", "skills", "chatgpt-only")
	writeSkillFixture(t, dir, "chatgpt-only", "ChatGPT-only skill")
	writeTestFile(t, filepath.Join(dir, "agents", "openai.yaml"), "policy:\n  products: [chatgpt, atlas]\n")

	result, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	skill := findSkillByName(t, result.Skills, "chatgpt-only")
	if skill.AppCLI.State != AvailabilityUnknown || skill.AppCLI.ReasonCode != ReasonProductRestricted {
		t.Fatalf("app diagnostic = %#v, want product restriction", skill.AppCLI)
	}
	if skill.MediaGo.State != AvailabilityUnknown || skill.MediaGo.ReasonCode != ReasonProductRestricted {
		t.Fatalf("MediaGo diagnostic = %#v, want product restriction", skill.MediaGo)
	}
}

func TestServiceInvalidProductMetadataFailsOpen(t *testing.T) {
	for _, product := range []string{"ChatGPT", "typo"} {
		t.Run(product, func(t *testing.T) {
			home := t.TempDir()
			dir := filepath.Join(home, ".agents", "skills", "invalid-product")
			writeSkillFixture(t, dir, "invalid-product", "Invalid product metadata")
			writeTestFile(t, filepath.Join(dir, "agents", "openai.yaml"), "policy:\n  products: ["+product+"]\n")
			service := testService(home)

			result, err := service.List(context.Background())
			if err != nil {
				t.Fatalf("List returned error: %v", err)
			}
			skill := findSkillByName(t, result.Skills, "invalid-product")
			if skill.AppCLI.State != AvailabilityAvailable || skill.MediaGo.State != AvailabilityAvailable || len(skill.Products) != 0 {
				t.Fatalf("skill = %#v, want fail-open availability", skill)
			}
			detail, err := service.Get(context.Background(), skill.ID)
			if err != nil {
				t.Fatalf("Get returned error: %v", err)
			}
			if !hasIssue(detail.Issues, IssueMetadataInvalid) {
				t.Fatalf("issues = %#v, want metadata warning", detail.Issues)
			}
		})
	}
}

func TestServiceKeepsDistinctPhysicalSkillsWithSameName(t *testing.T) {
	home := t.TempDir()
	writeSkillFixture(t, filepath.Join(home, ".agents", "skills", "first"), "duplicate", "First copy")
	writeSkillFixture(t, filepath.Join(home, ".agents", "skills", "second"), "duplicate", "Second copy")
	first, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("first List returned error: %v", err)
	}
	second, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("second List returned error: %v", err)
	}
	if len(first.Skills) != 2 || len(second.Skills) != 2 {
		t.Fatalf("skills = %#v, want two physical copies", first.Skills)
	}
	if first.Skills[0].ID == first.Skills[1].ID {
		t.Fatalf("ids should be distinct: %#v", first.Skills)
	}
	for index := range first.Skills {
		if first.Skills[index].SameNameCount != 2 || first.Skills[index].ID != second.Skills[index].ID {
			t.Fatalf("first=%#v second=%#v, want stable same-name diagnostics", first.Skills, second.Skills)
		}
	}
}

func TestServiceSkipsHiddenDirectoriesAndSystemSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink behavior differs on Windows")
	}
	home := t.TempDir()
	writeSkillFixture(t, filepath.Join(home, ".agents", "skills", ".hidden"), "hidden", "Hidden skill")
	target := filepath.Join(home, "system-target")
	writeSkillFixture(t, target, "linked-system", "Linked system skill")
	link := filepath.Join(home, ".codex", "skills", ".system", "linked-system")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatalf("creating system root: %v", err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("creating system symlink: %v", err)
	}
	symlinkTarget := filepath.Join(home, "symlinked-skill.md")
	writeTestFile(t, symlinkTarget, "---\nname: linked-file\ndescription: Symlinked file.\n---\n")
	userSymlinkDir := filepath.Join(home, ".agents", "skills", "linked-file")
	if err := os.MkdirAll(userSymlinkDir, 0o755); err != nil {
		t.Fatalf("creating user symlink skill directory: %v", err)
	}
	if err := os.Symlink(symlinkTarget, filepath.Join(userSymlinkDir, "SKILL.md")); err != nil {
		t.Fatalf("creating user SKILL.md symlink: %v", err)
	}

	result, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(result.Skills) != 0 {
		t.Fatalf("skills = %#v, want hidden and system symlink entries skipped", result.Skills)
	}
}

func TestServiceSkipsNonRegularSkillFilesWithoutBlocking(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("named pipes differ on Windows")
	}
	mkfifo, err := exec.LookPath("mkfifo")
	if err != nil {
		t.Skip("mkfifo is unavailable")
	}
	home := t.TempDir()
	skillDir := filepath.Join(home, ".agents", "skills", "named-pipe")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("creating named pipe skill directory: %v", err)
	}
	if output, err := exec.Command(mkfifo, filepath.Join(skillDir, "SKILL.md")).CombinedOutput(); err != nil {
		t.Fatalf("creating named pipe: %v: %s", err, output)
	}

	type listResult struct {
		response ListResponse
		err      error
	}
	resultChannel := make(chan listResult, 1)
	go func() {
		response, listErr := testService(home).List(context.Background())
		resultChannel <- listResult{response: response, err: listErr}
	}()
	select {
	case result := <-resultChannel:
		if result.err != nil {
			t.Fatalf("List returned error: %v", result.err)
		}
		if len(result.response.Skills) != 0 {
			t.Fatalf("skills = %#v, want non-regular SKILL.md skipped", result.response.Skills)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("List blocked while opening a non-regular SKILL.md")
	}
}

func TestServiceScansRootSkillAndContinuesBelowSkillDirectories(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, ".agents", "skills")
	writeSkillFixture(t, root, "root-skill", "Skill stored at discovery root")
	writeSkillFixture(t, filepath.Join(root, "nested"), "nested-skill", "Nested below a skill directory")

	result, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(result.Skills) != 2 {
		t.Fatalf("skills = %#v, want root and nested skills", result.Skills)
	}
	findSkillByName(t, result.Skills, "root-skill")
	findSkillByName(t, result.Skills, "nested-skill")
}

func TestServiceHonorsDiscoveryDepthLimit(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, ".agents", "skills")
	within := filepath.Join(root, "within", "a", "b", "c", "d", "e")
	beyond := filepath.Join(root, "beyond", "a", "b", "c", "d", "e", "f")
	writeSkillFixture(t, within, "within", "Within scan depth")
	writeSkillFixture(t, beyond, "beyond", "Beyond scan depth")

	result, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(result.Skills) != 1 || result.Skills[0].Name != "within" {
		t.Fatalf("skills = %#v, want only depth-six skill", result.Skills)
	}
}

func TestServiceReportsTraversalLimitAndCancellation(t *testing.T) {
	t.Run("directory limit", func(t *testing.T) {
		home := t.TempDir()
		root := filepath.Join(home, ".agents", "skills")
		for _, name := range []string{"a", "b", "c", "d"} {
			if err := os.MkdirAll(filepath.Join(root, name), 0o755); err != nil {
				t.Fatalf("creating directory %s: %v", name, err)
			}
		}
		service := NewServiceWithOptions(filepath.Join(home, "workspace"), ServiceOptions{
			HomeDir:          func() (string, error) { return home, nil },
			LookupEnv:        func(string) (string, bool) { return "", false },
			AdminRoots:       []string{},
			maxDiscoveryDirs: 3,
		})
		result, err := service.List(context.Background())
		if err != nil {
			t.Fatalf("List returned error: %v", err)
		}
		if !hasIssue(result.Issues, IssueRootScanLimit) {
			t.Fatalf("issues = %#v, want traversal limit warning", result.Issues)
		}
	})

	t.Run("cancelled context", func(t *testing.T) {
		home := t.TempDir()
		if err := os.MkdirAll(filepath.Join(home, ".agents", "skills"), 0o755); err != nil {
			t.Fatalf("creating root: %v", err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		result, err := testService(home).List(ctx)
		if err != nil {
			t.Fatalf("List returned error: %v", err)
		}
		if !hasIssue(result.Issues, IssueRootScanLimit) {
			t.Fatalf("issues = %#v, want cancellation warning", result.Issues)
		}
	})
}

func TestServiceEntryLimitProcessesBoundaryDeterministically(t *testing.T) {
	tests := []struct {
		name           string
		setup          func(*testing.T, string)
		wantSkills     []string
		wantLimitIssue bool
	}{
		{
			name: "exactly at cap processes every entry",
			setup: func(t *testing.T, root string) {
				writeTestFile(t, filepath.Join(root, "a.txt"), "a")
				writeTestFile(t, filepath.Join(root, "b.txt"), "b")
				writeSkillFixture(t, filepath.Join(root, "c-skill"), "c-skill", "Boundary skill")
			},
			wantSkills: []string{"c-skill"},
		},
		{
			name: "entry after cap is skipped with partial issue",
			setup: func(t *testing.T, root string) {
				writeSkillFixture(t, filepath.Join(root, "a-skill"), "a-skill", "Before cap")
				writeTestFile(t, filepath.Join(root, "b.txt"), "b")
				writeTestFile(t, filepath.Join(root, "c.txt"), "c")
				writeSkillFixture(t, filepath.Join(root, "z-skill"), "z-skill", "After cap")
			},
			wantSkills:     []string{"a-skill"},
			wantLimitIssue: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			home := t.TempDir()
			root := filepath.Join(home, ".agents", "skills")
			tt.setup(t, root)
			service := NewServiceWithOptions(filepath.Join(home, "workspace"), ServiceOptions{
				HomeDir:             func() (string, error) { return home, nil },
				LookupEnv:           func(string) (string, bool) { return "", false },
				AdminRoots:          []string{},
				maxDiscoveryDirs:    20,
				maxDiscoveryEntries: 4,
			})
			result, err := service.List(context.Background())
			if err != nil {
				t.Fatalf("List returned error: %v", err)
			}
			gotNames := make([]string, 0, len(result.Skills))
			for _, skill := range result.Skills {
				gotNames = append(gotNames, skill.Name)
			}
			if strings.Join(gotNames, ",") != strings.Join(tt.wantSkills, ",") {
				t.Fatalf("skills = %#v, want %#v", gotNames, tt.wantSkills)
			}
			if gotIssue := hasIssue(result.Issues, IssueRootScanLimit); gotIssue != tt.wantLimitIssue {
				t.Fatalf("limit issue = %v, want %v; issues=%#v", gotIssue, tt.wantLimitIssue, result.Issues)
			}
		})
	}
}

func TestServiceSortsMediaGoAvailableSkillsFirst(t *testing.T) {
	home := t.TempDir()
	userDir := filepath.Join(home, ".agents", "skills", "restricted-user")
	writeSkillFixture(t, userDir, "restricted-user", "Restricted user skill")
	writeTestFile(t, filepath.Join(userDir, "agents", "openai.yaml"), "policy:\n  products: [chatgpt]\n")
	adminRoot := filepath.Join(home, "admin")
	writeSkillFixture(t, filepath.Join(adminRoot, "available-admin"), "available-admin", "Available admin skill")
	service := NewServiceWithOptions(filepath.Join(home, "workspace"), ServiceOptions{
		HomeDir:    func() (string, error) { return home, nil },
		LookupEnv:  func(string) (string, bool) { return "", false },
		AdminRoots: []string{adminRoot},
	})

	result, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(result.Skills) != 2 || result.Skills[0].Name != "available-admin" || result.Skills[0].MediaGo.State != AvailabilityAvailable {
		t.Fatalf("skills = %#v, want available item first", result.Skills)
	}
}

func TestServiceTreatsMalformedConfigAsPartialIssue(t *testing.T) {
	home := t.TempDir()
	writeSkillFixture(t, filepath.Join(home, ".agents", "skills", "shared"), "shared", "Shared skill")
	writeTestFile(t, filepath.Join(home, ".codex", "config.toml"), "[[skills.config]\npath = true")
	result, err := testService(home).List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(result.Skills) != 1 || result.Skills[0].AppCLI.State != AvailabilityUnknown {
		t.Fatalf("skills = %#v, want host availability unknown", result.Skills)
	}
	if !hasIssue(result.Issues, IssueConfigInvalid) {
		t.Fatalf("issues = %#v, want config issue", result.Issues)
	}
}

func TestServiceDetailUsesStableIDNotPath(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".agents", "skills", "detail")
	raw := "---\nname: detail\ndescription: Detail skill.\n---\n\n# Detail\n"
	writeTestFile(t, filepath.Join(dir, "SKILL.md"), raw)
	service := testService(home)
	list, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	detail, err := service.Get(context.Background(), list.Skills[0].ID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if detail.RawContent != raw || detail.ID != list.Skills[0].ID {
		t.Fatalf("detail = %#v, want raw content and matching id", detail)
	}
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("encoding detail: %v", err)
	}
	if !strings.Contains(string(detailJSON), `"dependencies":[]`) || !strings.Contains(string(detailJSON), `"issues":[]`) {
		t.Fatalf("detail JSON = %s, want non-null empty arrays", detailJSON)
	}
	for _, malicious := range []string{"../../etc/passwd", filepath.Join(home, ".agents", "skills", "detail", "SKILL.md"), ""} {
		if _, err := service.Get(context.Background(), malicious); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Get(%q) error = %v, want ErrNotFound", malicious, err)
		}
	}
}

func TestServiceScanDropsRawContentUntilDetailRead(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".agents", "skills", "bounded-detail")
	raw := "---\nname: bounded-detail\ndescription: Detail is loaded on demand.\n---\n\n# body-marker\n"
	writeTestFile(t, filepath.Join(dir, "SKILL.md"), raw)
	service := testService(home)

	scan, err := service.scan(context.Background())
	if err != nil {
		t.Fatalf("scan returned error: %v", err)
	}
	if len(scan.response.Skills) != 1 || len(scan.records) != 1 {
		t.Fatalf("scan = %#v, want one skill record", scan.response)
	}
	for _, record := range scan.records {
		if record.parsed.raw != "" {
			t.Fatalf("scan retained %d raw bytes, want metadata-only records", len(record.parsed.raw))
		}
		if !record.parsed.previewAvailable {
			t.Fatal("scan should retain preview availability metadata")
		}
	}

	detail, err := service.Get(context.Background(), scan.response.Skills[0].ID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if detail.RawContent != raw || !detail.PreviewAvailable {
		t.Fatalf("detail preview = available:%v raw:%q, want bounded on-demand content", detail.PreviewAvailable, detail.RawContent)
	}
}

func TestLoadDetailPreviewRejectsSkillFileReplacedAfterScan(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink and named pipe behavior differs on Windows")
	}
	mkfifo, _ := exec.LookPath("mkfifo")
	tests := []struct {
		name    string
		replace func(*testing.T, string)
	}{
		{
			name: "symlink",
			replace: func(t *testing.T, skillPath string) {
				t.Helper()
				target := filepath.Join(t.TempDir(), "target.md")
				writeTestFile(t, target, "---\nname: replacement\ndescription: Replacement.\n---\n")
				if err := os.Symlink(target, skillPath); err != nil {
					t.Fatalf("replacing skill with symlink: %v", err)
				}
			},
		},
		{
			name: "named pipe",
			replace: func(t *testing.T, skillPath string) {
				t.Helper()
				if mkfifo == "" {
					t.Skip("mkfifo is unavailable")
				}
				if output, err := exec.Command(mkfifo, skillPath).CombinedOutput(); err != nil {
					t.Fatalf("replacing skill with named pipe: %v: %s", err, output)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			home := t.TempDir()
			dir := filepath.Join(home, ".agents", "skills", "replace-after-scan")
			writeSkillFixture(t, dir, "replace-after-scan", "Original skill")
			scan, err := testService(home).scan(context.Background())
			if err != nil {
				t.Fatalf("scan returned error: %v", err)
			}
			var record inventoryRecord
			for _, candidate := range scan.records {
				record = candidate
			}
			if record.parsed.absolutePath == "" {
				t.Fatal("scan did not return a skill record")
			}
			if err := os.Remove(record.parsed.absolutePath); err != nil {
				t.Fatalf("removing original skill: %v", err)
			}
			tt.replace(t, record.parsed.absolutePath)

			type previewResult struct {
				raw       string
				available bool
				issues    []Issue
			}
			resultChannel := make(chan previewResult, 1)
			go func() {
				raw, available, issues := loadDetailPreview(record.parsed)
				resultChannel <- previewResult{raw: raw, available: available, issues: issues}
			}()
			select {
			case result := <-resultChannel:
				if result.raw != "" || result.available || !hasIssue(result.issues, IssueSkillFileUnreadable) {
					t.Fatalf("preview = raw:%q available:%v issues:%#v, want unreadable replacement", result.raw, result.available, result.issues)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("detail preview blocked while opening a replaced non-regular SKILL.md")
			}
		})
	}
}

func TestServiceListRedactsExternalDiscoveryPaths(t *testing.T) {
	home := t.TempDir()
	customCodexHome := filepath.Join(t.TempDir(), "external-codex-home")
	adminRoot := filepath.Join(t.TempDir(), "external-admin-root")
	unreadableAdminRoot := filepath.Join(t.TempDir(), "not-a-directory")
	writeSkillFixture(t, filepath.Join(customCodexHome, "skills", "legacy"), "legacy", "External Codex home skill")
	writeSkillFixture(t, filepath.Join(adminRoot, "managed"), "managed", "External admin skill")
	writeTestFile(t, filepath.Join(customCodexHome, "config.toml"), "[[skills.config]\ninvalid = [")
	writeTestFile(t, unreadableAdminRoot, "not a directory")

	service := NewServiceWithOptions(filepath.Join(home, "workspace"), ServiceOptions{
		HomeDir: func() (string, error) { return home, nil },
		LookupEnv: func(name string) (string, bool) {
			if name == "CODEX_HOME" {
				return customCodexHome, true
			}
			return "", false
		},
		AdminRoots: []string{adminRoot, unreadableAdminRoot},
	})
	result, err := service.List(context.Background())
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("encoding list: %v", err)
	}
	payload := string(encoded)
	for _, privatePath := range []string{customCodexHome, adminRoot, unreadableAdminRoot} {
		if strings.Contains(payload, privatePath) {
			t.Fatalf("list JSON leaked external path %q: %s", privatePath, payload)
		}
	}
	for _, symbolicPath := range []string{
		"$CODEX_HOME/skills",
		"$CODEX_HOME/config.toml",
		"$ADMIN_SKILLS/1",
		"$ADMIN_SKILLS/2",
	} {
		if !strings.Contains(payload, symbolicPath) {
			t.Fatalf("list JSON = %s, want symbolic path %q", payload, symbolicPath)
		}
	}

	legacy := findSkillByName(t, result.Skills, "legacy")
	if legacy.DisplayPath != "$CODEX_HOME/skills/legacy/SKILL.md" ||
		len(legacy.Origins) != 1 || legacy.Origins[0].DisplayPath != legacy.DisplayPath {
		t.Fatalf("legacy paths = summary:%q origins:%#v", legacy.DisplayPath, legacy.Origins)
	}
	managed := findSkillByName(t, result.Skills, "managed")
	if managed.DisplayPath != "$ADMIN_SKILLS/1/managed/SKILL.md" {
		t.Fatalf("managed display path = %q", managed.DisplayPath)
	}
	detail, err := service.Get(context.Background(), legacy.ID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	wantAbsolute := filepath.Join(customCodexHome, "skills", "legacy", "SKILL.md")
	if detail.AbsolutePath != wantAbsolute {
		t.Fatalf("detail absolute path = %q, want %q", detail.AbsolutePath, wantAbsolute)
	}
}

func TestServiceReturnsFatalProviderErrors(t *testing.T) {
	service := NewServiceWithOptions(t.TempDir(), ServiceOptions{
		HomeDir: func() (string, error) { return "", errors.New("home unavailable") },
	})
	if _, err := service.List(context.Background()); err == nil || !strings.Contains(err.Error(), "home") {
		t.Fatalf("List error = %v, want home provider failure", err)
	}
}

func testService(home string) *Service {
	return NewServiceWithOptions(filepath.Join(home, "workspace"), ServiceOptions{
		HomeDir:    func() (string, error) { return home, nil },
		LookupEnv:  func(string) (string, bool) { return "", false },
		AdminRoots: []string{},
	})
}

func writeSkillFixture(t *testing.T, dir string, name string, description string) {
	t.Helper()
	writeTestFile(t, filepath.Join(dir, "SKILL.md"), "---\nname: "+name+"\ndescription: "+description+"\n---\n\n# "+name+"\n")
}

func assertSources(t *testing.T, skills []SkillSummary, want map[Source]int) {
	t.Helper()
	got := map[Source]int{}
	for _, skill := range skills {
		got[skill.Source]++
	}
	for source, count := range want {
		if got[source] != count {
			t.Fatalf("source counts = %#v, want %s=%d", got, source, count)
		}
	}
}

func findSkillByName(t *testing.T, skills []SkillSummary, name string) SkillSummary {
	t.Helper()
	for _, skill := range skills {
		if skill.Name == name {
			return skill
		}
	}
	t.Fatalf("skill %q not found in %#v", name, skills)
	return SkillSummary{}
}
