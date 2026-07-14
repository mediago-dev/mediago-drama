package codexskill

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseSkillDirectory(t *testing.T) {
	tests := []struct {
		name            string
		skill           string
		metadata        string
		wantValid       bool
		wantIssue       IssueCode
		wantName        string
		wantDisplay     string
		wantDescription string
		wantTools       int
		wantImplicit    *bool
		wantProducts    []string
		wantResources   bool
	}{
		{
			name:          "valid skill and optional metadata",
			skill:         "---\nname: release-check\ndescription: Validate a release.\n---\n\n# Release Check\n",
			metadata:      "interface:\n  display_name: Release Check\n  short_description: Check releases\n  default_prompt: Run the release checklist.\npolicy:\n  allow_implicit_invocation: false\n  products: [codex]\ndependencies:\n  tools:\n    - type: mcp\n      value: docs\n      description: Documentation server\n      transport: streamable_http\n      url: https://example.com/mcp\n",
			wantValid:     true,
			wantName:      "release-check",
			wantDisplay:   "Release Check",
			wantTools:     1,
			wantImplicit:  boolPointer(false),
			wantProducts:  []string{"codex"},
			wantResources: true,
		},
		{
			name:      "missing delimiters",
			skill:     "name: release-check\ndescription: Validate a release.\n",
			wantIssue: IssueFrontmatterMissing,
		},
		{
			name:      "invalid yaml",
			skill:     "---\nname: \"unterminated\ndescription: broken\n---\n",
			wantIssue: IssueFrontmatterInvalid,
		},
		{
			name:      "missing name",
			skill:     "---\ndescription: Validate a release.\n---\n",
			wantValid: true,
			wantName:  "__directory__",
			wantIssue: IssueNameRequired,
		},
		{
			name:      "missing description",
			skill:     "---\nname: release-check\n---\n",
			wantName:  "release-check",
			wantIssue: IssueDescriptionRequired,
		},
		{
			name:      "invalid optional metadata does not invalidate skill",
			skill:     "---\nname: release-check\ndescription: Validate a release.\n---\n",
			metadata:  "interface: [\n",
			wantValid: true,
			wantName:  "release-check",
			wantIssue: IssueMetadataInvalid,
		},
		{
			name:            "unquoted colon scalar is repaired",
			skill:           "---\nname: repair-colon\ndescription: Use this when: validating releases # retained comment\nextension: accepted\n---\n",
			wantValid:       true,
			wantName:        "repair-colon",
			wantDescription: "Use this when: validating releases",
		},
		{
			name:      "multiline name is normalized to one line",
			skill:     "---\nname: |\n  release\n  check\ndescription: Validate a release.\n---\n",
			wantValid: true,
			wantName:  "release check",
		},
		{
			name:            "multiline description is normalized to one line",
			skill:           "---\nname: multiline-description\ndescription: |\n  First line.\n  Second line.\n---\n",
			wantValid:       true,
			wantName:        "multiline-description",
			wantDescription: "First line. Second line.",
		},
		{
			name:      "invalid flow-like extension scalar is repaired",
			skill:     "---\nname: repaired-extension\ndescription: Extension fields remain compatible.\ntags: [next,@supabase/ssr]\n---\n",
			wantValid: true,
			wantName:  "repaired-extension",
		},
		{
			name:         "uppercase product alias is normalized",
			skill:        "---\nname: uppercase-product\ndescription: Uppercase alias.\n---\n",
			metadata:     "policy:\n  products: [CODEX]\n",
			wantValid:    true,
			wantName:     "uppercase-product",
			wantProducts: []string{"codex"},
		},
		{
			name:      "mixed case product fails open",
			skill:     "---\nname: mixed-product\ndescription: Mixed product.\n---\n",
			metadata:  "interface:\n  display_name: Should Not Apply\npolicy:\n  products: [ChatGPT]\n",
			wantValid: true,
			wantName:  "mixed-product",
			wantIssue: IssueMetadataInvalid,
		},
		{
			name:      "unknown product fails open",
			skill:     "---\nname: unknown-product\ndescription: Unknown product.\n---\n",
			metadata:  "interface:\n  display_name: Should Not Apply\npolicy:\n  products: [typo]\n",
			wantValid: true,
			wantName:  "unknown-product",
			wantIssue: IssueMetadataInvalid,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			writeTestFile(t, filepath.Join(dir, "SKILL.md"), tt.skill)
			if tt.metadata != "" {
				writeTestFile(t, filepath.Join(dir, "agents", "openai.yaml"), tt.metadata)
			}
			if tt.wantResources {
				for _, name := range []string{"scripts", "references", "assets"} {
					if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
						t.Fatalf("creating %s: %v", name, err)
					}
				}
			}

			parsed := parseSkillDirectory(SourceUserShared, dir, dir, filepath.Dir(dir))
			if parsed.summary.Valid != tt.wantValid {
				t.Fatalf("valid = %v, want %v; issues=%#v", parsed.summary.Valid, tt.wantValid, parsed.issues)
			}
			wantName := tt.wantName
			if wantName == "__directory__" {
				wantName = filepath.Base(dir)
			}
			if parsed.summary.Name != wantName {
				t.Fatalf("name = %q, want %q", parsed.summary.Name, wantName)
			}
			if tt.wantDisplay != "" && parsed.summary.DisplayName != tt.wantDisplay {
				t.Fatalf("display name = %q, want %q", parsed.summary.DisplayName, tt.wantDisplay)
			}
			if tt.wantDescription != "" && parsed.summary.Description != tt.wantDescription {
				t.Fatalf("description = %q, want %q", parsed.summary.Description, tt.wantDescription)
			}
			if tt.wantIssue == IssueMetadataInvalid && strings.Contains(tt.metadata, "Should Not Apply") && parsed.summary.DisplayName == "Should Not Apply" {
				t.Fatalf("invalid metadata should fail open without applying interface fields")
			}
			if len(parsed.dependencies) != tt.wantTools {
				t.Fatalf("dependencies = %#v, want %d", parsed.dependencies, tt.wantTools)
			}
			if tt.wantTools > 0 {
				dependency := parsed.dependencies[0]
				if dependency.Type != "mcp" || dependency.Value != "docs" || dependency.Transport != "streamable_http" || dependency.URL != "https://example.com/mcp" {
					t.Fatalf("dependency = %#v, want parsed optional fields", dependency)
				}
			}
			if !equalOptionalBool(parsed.summary.AllowImplicitInvocation, tt.wantImplicit) {
				t.Fatalf("allow implicit = %#v, want %#v", parsed.summary.AllowImplicitInvocation, tt.wantImplicit)
			}
			if strings.Join(parsed.summary.Products, ",") != strings.Join(tt.wantProducts, ",") {
				t.Fatalf("products = %#v, want %#v", parsed.summary.Products, tt.wantProducts)
			}
			if tt.wantResources && (!parsed.summary.HasScripts || !parsed.summary.HasReferences || !parsed.summary.HasAssets) {
				t.Fatalf("resource flags = scripts:%v references:%v assets:%v", parsed.summary.HasScripts, parsed.summary.HasReferences, parsed.summary.HasAssets)
			}
			if tt.wantIssue != "" && !hasIssue(parsed.issues, tt.wantIssue) {
				t.Fatalf("issues = %#v, want %q", parsed.issues, tt.wantIssue)
			}
		})
	}
}

func TestParseSkillDirectoryRejectsOverlongFallbackName(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, strings.Repeat("n", 65))
	writeTestFile(t, filepath.Join(dir, "SKILL.md"), "---\ndescription: Uses a fallback name.\n---\n")
	parsed := parseSkillDirectory(SourceUserShared, dir, dir, root)
	if parsed.summary.Valid || !hasIssue(parsed.issues, IssueNameRequired) || !hasIssue(parsed.issues, IssueNameInvalid) {
		t.Fatalf("parsed = %#v issues=%#v, want overlong fallback invalid", parsed.summary, parsed.issues)
	}
}

func TestParseSkillDirectoryLeavesDisplayNameEmptyWithoutOptionalMetadata(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "code-1.0.4")
	writeTestFile(t, filepath.Join(dir, "SKILL.md"), "---\nname: Code\ndescription: Coding workflow.\n---\n")

	parsed := parseSkillDirectory(SourceUserShared, dir, dir, root)
	if !parsed.summary.Valid || parsed.summary.Name != "Code" {
		t.Fatalf("summary = %#v, want valid frontmatter name", parsed.summary)
	}
	if parsed.summary.DisplayName != "" {
		t.Fatalf("display name = %q, want empty fallback to frontmatter name", parsed.summary.DisplayName)
	}
}

func TestParseSkillDirectoryRejectsOversizedFiles(t *testing.T) {
	t.Run("skill", func(t *testing.T) {
		dir := t.TempDir()
		writeTestFile(t, filepath.Join(dir, "SKILL.md"), "---\nname: oversized\ndescription: Still valid.\nextension_field: accepted\n---\n"+strings.Repeat("x", maxSkillFileBytes+1))
		parsed := parseSkillDirectory(SourceUserShared, dir, dir, filepath.Dir(dir))
		if !parsed.summary.Valid || parsed.previewAvailable || parsed.raw != "" || !hasIssue(parsed.issues, IssuePreviewUnavailable) {
			t.Fatalf("parsed = %#v issues=%#v, want valid skill with unavailable preview", parsed.summary, parsed.issues)
		}
	})

	t.Run("metadata", func(t *testing.T) {
		dir := t.TempDir()
		writeTestFile(t, filepath.Join(dir, "SKILL.md"), "---\nname: valid\ndescription: Valid skill.\n---\n")
		writeTestFile(t, filepath.Join(dir, "agents", "openai.yaml"), strings.Repeat("x", maxMetadataFileBytes+1))
		parsed := parseSkillDirectory(SourceUserShared, dir, dir, filepath.Dir(dir))
		if !parsed.summary.Valid || !hasIssue(parsed.issues, IssueMetadataFileTooLarge) {
			t.Fatalf("parsed = %#v issues=%#v, want valid skill with metadata issue", parsed.summary, parsed.issues)
		}
	})
}

func boolPointer(value bool) *bool {
	return &value
}

func equalOptionalBool(left *bool, right *bool) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func hasIssue(issues []Issue, code IssueCode) bool {
	for _, issue := range issues {
		if issue.Code == code {
			return true
		}
	}
	return false
}

func writeTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("creating parent directory for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
}
