package codexskill

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

const (
	maxSkillFileBytes    = 256 * 1024
	maxMetadataFileBytes = 64 * 1024
)

var errFileTooLarge = errors.New("file exceeds read limit")
var errFileNotRegular = errors.New("file is not regular")

type parsedSkill struct {
	summary          SkillSummary
	absolutePath     string
	resolvedPath     string
	raw              string
	previewAvailable bool
	dependencies     []ToolDependency
	issues           []Issue
}

type skillFrontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

type openAIMetadata struct {
	Interface struct {
		DisplayName      string `yaml:"display_name"`
		ShortDescription string `yaml:"short_description"`
		DefaultPrompt    string `yaml:"default_prompt"`
	} `yaml:"interface"`
	Policy struct {
		AllowImplicitInvocation *bool    `yaml:"allow_implicit_invocation"`
		Products                []string `yaml:"products"`
	} `yaml:"policy"`
	Dependencies struct {
		Tools []ToolDependency `yaml:"tools"`
	} `yaml:"dependencies"`
}

func parseSkillDirectory(source Source, entryDir string, displayDir string, _ string) parsedSkill {
	entryDir = filepath.Clean(entryDir)
	skillPath := filepath.Join(entryDir, "SKILL.md")
	displayPath := joinDisplayPath(displayDir, "SKILL.md")
	parsed := parsedSkill{
		summary: SkillSummary{
			Source:            source,
			DisplayPath:       displayPath,
			SyntaxValidity:    SyntaxInvalid,
			SameNameCount:     1,
			SamePhysicalCount: 1,
		},
		dependencies: []ToolDependency{},
		issues:       []Issue{},
		absolutePath: skillPath,
	}
	if info, err := os.Lstat(entryDir); err == nil {
		parsed.summary.Linked = info.Mode()&os.ModeSymlink != 0
	}
	if resolved, err := filepath.EvalSymlinks(skillPath); err == nil {
		if absolute, absErr := filepath.Abs(resolved); absErr == nil {
			parsed.resolvedPath = filepath.Clean(absolute)
		}
	}
	parsed.summary.HasScripts = isDirectory(filepath.Join(entryDir, "scripts"))
	parsed.summary.HasReferences = isDirectory(filepath.Join(entryDir, "references"))
	parsed.summary.HasAssets = isDirectory(filepath.Join(entryDir, "assets"))

	raw, truncated, err := readFilePreview(skillPath, maxSkillFileBytes)
	if err != nil {
		code, message := skillReadIssue(err)
		parsed.issues = append(parsed.issues, Issue{
			Code:        code,
			Message:     message,
			Source:      source,
			DisplayPath: displayPath,
		})
		return parsed
	}
	if truncated {
		parsed.issues = append(parsed.issues, Issue{
			Code:        IssuePreviewUnavailable,
			Message:     "SKILL.md 超过 256 KiB，未加载原始内容预览。",
			Source:      source,
			DisplayPath: displayPath,
		})
	} else {
		parsed.raw = string(raw)
		parsed.previewAvailable = true
	}
	frontmatter, issue := parseFrontmatter(raw)
	if issue != nil {
		issue.Source = source
		issue.DisplayPath = displayPath
		parsed.issues = append(parsed.issues, *issue)
		return parsed
	}
	parsed.summary.Name = singleLine(frontmatter.Name)
	parsed.summary.Description = singleLine(frontmatter.Description)
	if parsed.summary.Name == "" {
		fallbackDir := entryDir
		if parsed.resolvedPath != "" {
			fallbackDir = filepath.Dir(parsed.resolvedPath)
		}
		parsed.summary.Name = filepath.Base(fallbackDir)
		parsed.issues = append(parsed.issues, Issue{
			Code:        IssueNameRequired,
			Message:     "SKILL.md frontmatter 缺少 name，已使用目录名。",
			Source:      source,
			DisplayPath: displayPath,
		})
	}
	if utf8.RuneCountInString(parsed.summary.Name) > 64 {
		parsed.issues = append(parsed.issues, Issue{
			Code:        IssueNameInvalid,
			Message:     "Skill 名称超过 64 个字符。",
			Source:      source,
			DisplayPath: displayPath,
		})
	}
	if parsed.summary.Description == "" {
		parsed.issues = append(parsed.issues, Issue{
			Code:        IssueDescriptionRequired,
			Message:     "SKILL.md frontmatter 缺少 description。",
			Source:      source,
			DisplayPath: displayPath,
		})
	}
	parseOptionalMetadata(&parsed, entryDir, displayDir, source)
	parsed.summary.DependencyCount = len(parsed.dependencies)
	if parsed.summary.Description == "" || utf8.RuneCountInString(parsed.summary.Name) > 64 {
		return parsed
	}
	parsed.summary.Valid = true
	parsed.summary.SyntaxValidity = SyntaxValid
	return parsed
}

func parseFrontmatter(raw []byte) (skillFrontmatter, *Issue) {
	normalized := strings.ReplaceAll(strings.TrimPrefix(string(raw), "\ufeff"), "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return skillFrontmatter{}, &Issue{
			Code:    IssueFrontmatterMissing,
			Message: "SKILL.md 缺少 YAML frontmatter 起止分隔符。",
		}
	}
	closing := -1
	for index := 1; index < len(lines); index++ {
		if strings.TrimSpace(lines[index]) == "---" {
			closing = index
			break
		}
	}
	if closing < 0 {
		return skillFrontmatter{}, &Issue{
			Code:    IssueFrontmatterMissing,
			Message: "SKILL.md 缺少 YAML frontmatter 结束分隔符。",
		}
	}
	var frontmatter skillFrontmatter
	metadata := strings.Join(lines[1:closing], "\n")
	if err := yaml.Unmarshal([]byte(metadata), &frontmatter); err != nil {
		repaired := repairUnquotedColonScalars(metadata)
		if repaired == metadata || yaml.Unmarshal([]byte(repaired), &frontmatter) != nil {
			return skillFrontmatter{}, &Issue{
				Code:    IssueFrontmatterInvalid,
				Message: "SKILL.md frontmatter 不是有效的 YAML。",
			}
		}
	}
	return frontmatter, nil
}

func parseOptionalMetadata(parsed *parsedSkill, entryDir string, displayDir string, source Source) {
	metadataPath := filepath.Join(entryDir, "agents", "openai.yaml")
	data, err := readCappedFile(metadataPath, maxMetadataFileBytes)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		code := IssueMetadataUnreadable
		message := "无法读取 agents/openai.yaml。"
		if errors.Is(err, errFileTooLarge) {
			code = IssueMetadataFileTooLarge
			message = "agents/openai.yaml 超过 64 KiB 限制。"
		}
		parsed.issues = append(parsed.issues, Issue{
			Code:        code,
			Message:     message,
			Source:      source,
			DisplayPath: joinDisplayPath(displayDir, "agents", "openai.yaml"),
		})
		return
	}
	var metadata openAIMetadata
	if err := yaml.Unmarshal(data, &metadata); err != nil {
		appendMetadataInvalidIssue(parsed, displayDir, source)
		return
	}
	products, err := normalizedProducts(metadata.Policy.Products)
	if err != nil {
		appendMetadataInvalidIssue(parsed, displayDir, source)
		return
	}
	if displayName := strings.TrimSpace(metadata.Interface.DisplayName); displayName != "" {
		parsed.summary.DisplayName = displayName
	}
	parsed.summary.ShortDescription = strings.TrimSpace(metadata.Interface.ShortDescription)
	parsed.summary.DefaultPrompt = strings.TrimSpace(metadata.Interface.DefaultPrompt)
	parsed.summary.AllowImplicitInvocation = metadata.Policy.AllowImplicitInvocation
	parsed.summary.Products = products
	parsed.dependencies = make([]ToolDependency, 0, len(metadata.Dependencies.Tools))
	for _, dependency := range metadata.Dependencies.Tools {
		dependency.Type = strings.TrimSpace(dependency.Type)
		dependency.Value = strings.TrimSpace(dependency.Value)
		dependency.Description = strings.TrimSpace(dependency.Description)
		dependency.Transport = strings.TrimSpace(dependency.Transport)
		dependency.URL = strings.TrimSpace(dependency.URL)
		parsed.dependencies = append(parsed.dependencies, dependency)
	}
}

func readCappedFile(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, fmt.Errorf("reading bounded file: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, errFileTooLarge
	}
	return data, nil
}

func readFilePreview(path string, limit int64) ([]byte, bool, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, false, err
	}
	if !info.Mode().IsRegular() {
		return nil, false, errFileNotRegular
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, false, fmt.Errorf("reading bounded preview: %w", err)
	}
	if int64(len(data)) > limit {
		return data[:limit], true, nil
	}
	return data, false, nil
}

func skillReadIssue(err error) (IssueCode, string) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		return IssueSkillFileMissing, "候选目录缺少 SKILL.md。"
	default:
		return IssueSkillFileUnreadable, "无法读取 SKILL.md。"
	}
}

func isDirectory(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func singleLine(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func repairUnquotedColonScalars(metadata string) string {
	lines := strings.Split(metadata, "\n")
	changed := false
	for index, line := range lines {
		separator := strings.Index(line, ":")
		if separator < 0 {
			continue
		}
		key := strings.TrimSpace(line[:separator])
		value := strings.TrimSpace(line[separator+1:])
		if key == "" || strings.HasPrefix(key, "-") || value == "" {
			continue
		}
		scalar, comment := splitYAMLInlineComment(value)
		if scalar == "" || strings.ContainsAny(scalar[:1], "\"'|>") {
			continue
		}
		first := scalar[0]
		if !strings.Contains(scalar, ": ") && first != '[' && first != '{' && first != '@' && first != '`' {
			continue
		}
		indentAndKey := line[:separator+1]
		lines[index] = indentAndKey + " " + strconv.Quote(scalar)
		if comment != "" {
			lines[index] += " " + comment
		}
		changed = true
	}
	if !changed {
		return metadata
	}
	return strings.Join(lines, "\n")
}

func splitYAMLInlineComment(value string) (string, string) {
	for index := 0; index < len(value); index++ {
		if value[index] != '#' || (index > 0 && value[index-1] != ' ' && value[index-1] != '\t') {
			continue
		}
		return strings.TrimSpace(value[:index]), strings.TrimSpace(value[index:])
	}
	return strings.TrimSpace(value), ""
}

func normalizedProducts(products []string) ([]string, error) {
	if len(products) == 0 {
		return nil, nil
	}
	normalized := make([]string, 0, len(products))
	for _, product := range products {
		switch product {
		case "chatgpt", "CHATGPT":
			normalized = append(normalized, "chatgpt")
		case "codex", "CODEX":
			normalized = append(normalized, "codex")
		case "atlas", "ATLAS":
			normalized = append(normalized, "atlas")
		default:
			return nil, fmt.Errorf("unsupported product %q", product)
		}
	}
	return normalized, nil
}

func appendMetadataInvalidIssue(parsed *parsedSkill, displayDir string, source Source) {
	parsed.issues = append(parsed.issues, Issue{
		Code:        IssueMetadataInvalid,
		Message:     "agents/openai.yaml 不是有效的 metadata。",
		Source:      source,
		DisplayPath: joinDisplayPath(displayDir, "agents", "openai.yaml"),
	})
}
