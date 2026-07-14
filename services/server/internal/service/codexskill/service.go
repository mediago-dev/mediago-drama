package codexskill

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	slashpath "path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/pelletier/go-toml/v2"
)

const (
	maxDiscoveryDepth   = 6
	maxDiscoveryDirs    = 2000
	maxDiscoveryEntries = 20000
	maxConfigFileBytes  = 1024 * 1024
	skillIDPrefix       = "csk_"
	skillIDHexLength    = 32
)

// Service provides bounded, read-only Codex skill discovery.
type Service struct {
	workspaceDir string
	options      ServiceOptions
}

type rootSpec struct {
	source              Source
	path                string
	displayRoot         string
	mediaGoVisible      bool
	deprecated          bool
	followSymlinks      bool
	skipSystemContainer bool
}

type originRecord struct {
	SkillOrigin
	absolutePath string
	resolvedPath string
}

type inventoryRecord struct {
	parsed  parsedSkill
	origins []originRecord
}

type inventoryScan struct {
	response ListResponse
	records  map[string]inventoryRecord
}

type configDocument struct {
	Skills struct {
		Config  []configRule `toml:"config"`
		Bundled struct {
			Enabled *bool `toml:"enabled"`
		} `toml:"bundled"`
	} `toml:"skills"`
}

type configRule struct {
	Path    string `toml:"path"`
	Name    string `toml:"name"`
	Enabled *bool  `toml:"enabled"`
}

type configState struct {
	rules          []configRule
	bundledEnabled *bool
	problem        ReasonCode
}

// NewService creates a scanner using the process home, environment and admin roots.
func NewService(workspaceDir string, runtimeHome RuntimeHomeProvider) *Service {
	return NewServiceWithOptions(workspaceDir, ServiceOptions{RuntimeHome: runtimeHome})
}

// NewServiceWithOptions creates a scanner with injectable discovery providers.
func NewServiceWithOptions(workspaceDir string, options ServiceOptions) *Service {
	if options.HomeDir == nil {
		options.HomeDir = os.UserHomeDir
	}
	if options.LookupEnv == nil {
		options.LookupEnv = os.LookupEnv
	}
	if options.AdminRoots == nil {
		if runtime.GOOS == "windows" {
			options.AdminRoots = []string{}
		} else {
			options.AdminRoots = []string{"/etc/codex/skills"}
		}
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.maxDiscoveryDepth <= 0 {
		options.maxDiscoveryDepth = maxDiscoveryDepth
	}
	if options.maxDiscoveryDirs <= 0 {
		options.maxDiscoveryDirs = maxDiscoveryDirs
	}
	if options.maxDiscoveryEntries <= 0 {
		options.maxDiscoveryEntries = maxDiscoveryEntries
	}
	return &Service{workspaceDir: filepath.Clean(workspaceDir), options: options}
}

// List discovers global Codex skills and returns partial source diagnostics when possible.
func (service *Service) List(ctx context.Context) (ListResponse, error) {
	scan, err := service.scan(ctx)
	if err != nil {
		return ListResponse{}, err
	}
	return scan.response, nil
}

// Get rediscovers the inventory and returns detail for one opaque stable ID.
func (service *Service) Get(ctx context.Context, id string) (Detail, error) {
	if !validSkillID(id) {
		return Detail{}, ErrNotFound
	}
	scan, err := service.scan(ctx)
	if err != nil {
		return Detail{}, err
	}
	record, ok := scan.records[id]
	if !ok {
		return Detail{}, ErrNotFound
	}
	rawContent, previewAvailable, detailIssues := loadDetailPreview(record.parsed)
	return Detail{
		SkillSummary:     record.parsed.summary,
		AbsolutePath:     record.parsed.absolutePath,
		ResolvedPath:     record.parsed.resolvedPath,
		RawContent:       rawContent,
		PreviewAvailable: previewAvailable,
		Dependencies:     append([]ToolDependency{}, record.parsed.dependencies...),
		Issues:           detailIssues,
	}, nil
}

func loadDetailPreview(parsed parsedSkill) (string, bool, []Issue) {
	issues := append([]Issue{}, parsed.issues...)
	raw, truncated, err := readFilePreview(parsed.absolutePath, maxSkillFileBytes)
	if err != nil {
		code, message := skillReadIssue(err)
		issues = appendIssueOnce(issues, Issue{
			Code:        code,
			Message:     message,
			Source:      parsed.summary.Source,
			DisplayPath: parsed.summary.DisplayPath,
		})
		return "", false, issues
	}
	if truncated {
		issues = appendIssueOnce(issues, Issue{
			Code:        IssuePreviewUnavailable,
			Message:     "SKILL.md 超过 256 KiB，未加载原始内容预览。",
			Source:      parsed.summary.Source,
			DisplayPath: parsed.summary.DisplayPath,
		})
		return "", false, issues
	}
	return string(raw), true, issues
}

func appendIssueOnce(issues []Issue, candidate Issue) []Issue {
	for _, issue := range issues {
		if issue.Code == candidate.Code && issue.Source == candidate.Source && issue.DisplayPath == candidate.DisplayPath {
			return issues
		}
	}
	return append(issues, candidate)
}

func (service *Service) scan(ctx context.Context) (inventoryScan, error) {
	home, err := service.options.HomeDir()
	if err != nil {
		return inventoryScan{}, fmt.Errorf("resolving user home: %w", err)
	}
	home = strings.TrimSpace(home)
	if home == "" {
		return inventoryScan{}, errors.New("resolving user home: empty path")
	}
	home, err = filepath.Abs(home)
	if err != nil {
		return inventoryScan{}, fmt.Errorf("normalizing user home: %w", err)
	}

	hostCodexHome := filepath.Join(home, ".codex")
	hostCodexDisplay := displayPath(hostCodexHome, home)
	if configured, ok := service.options.LookupEnv("CODEX_HOME"); ok && strings.TrimSpace(configured) != "" {
		hostCodexHome, err = absoluteFrom(home, configured)
		if err != nil {
			return inventoryScan{}, fmt.Errorf("normalizing CODEX_HOME: %w", err)
		}
		hostCodexDisplay = "$CODEX_HOME"
	}

	issues := []Issue{}
	runtimeIsolated := false
	runtimeUnknown := false
	if service.options.RuntimeHome != nil {
		descriptor, descriptorErr := service.options.RuntimeHome(ctx)
		if descriptorErr != nil {
			runtimeUnknown = true
			issues = append(issues, Issue{
				Code:    IssueRuntimeHomeUnavailable,
				Message: "无法确认 MediaGo Codex 运行时目录。",
			})
		} else if descriptor.Isolated && strings.TrimSpace(descriptor.CodexHome) != "" {
			runtimeHome, homeErr := absoluteFrom(service.workspaceDir, descriptor.CodexHome)
			if homeErr != nil {
				runtimeUnknown = true
				issues = append(issues, Issue{
					Code:    IssueRuntimeHomeUnavailable,
					Message: "MediaGo Codex 运行时目录无效。",
				})
			} else {
				runtimeIsolated = comparablePath(runtimeHome) != comparablePath(hostCodexHome)
			}
		}
	}

	userSkillsRoot := filepath.Join(home, ".agents", "skills")
	codexSkillsRoot := filepath.Join(hostCodexHome, "skills")
	rootSpecs := []rootSpec{
		{
			source:         SourceUserShared,
			path:           userSkillsRoot,
			displayRoot:    displayPath(userSkillsRoot, home),
			mediaGoVisible: !runtimeUnknown,
			followSymlinks: true,
		},
		{
			source:              SourceCodexHome,
			path:                codexSkillsRoot,
			displayRoot:         joinDisplayPath(hostCodexDisplay, "skills"),
			mediaGoVisible:      !runtimeUnknown && !runtimeIsolated,
			deprecated:          true,
			followSymlinks:      true,
			skipSystemContainer: true,
		},
		{
			source:         SourceSystem,
			path:           filepath.Join(codexSkillsRoot, ".system"),
			displayRoot:    joinDisplayPath(hostCodexDisplay, "skills", ".system"),
			mediaGoVisible: !runtimeUnknown && !runtimeIsolated,
			followSymlinks: false,
		},
	}
	adminNumber := 0
	for _, adminRoot := range service.options.AdminRoots {
		adminRoot = strings.TrimSpace(adminRoot)
		if adminRoot == "" {
			continue
		}
		adminNumber++
		adminDisplayRoot := joinDisplayPath("$ADMIN_SKILLS", fmt.Sprintf("%d", adminNumber))
		adminPath, pathErr := absoluteFrom(home, adminRoot)
		if pathErr != nil {
			issues = append(issues, Issue{
				Code:        IssueRootUnreadable,
				Message:     "管理员 Skill 来源路径无效。",
				Source:      SourceAdmin,
				DisplayPath: adminDisplayRoot,
			})
			continue
		}
		rootSpecs = append(rootSpecs, rootSpec{
			source:         SourceAdmin,
			path:           adminPath,
			displayRoot:    adminDisplayRoot,
			mediaGoVisible: !runtimeUnknown,
			followSymlinks: true,
		})
	}

	roots := make([]Root, 0, len(rootSpecs))
	physicalRecords := map[string]inventoryRecord{}
	for _, spec := range rootSpecs {
		root, candidates, rootIssues := scanRoot(
			ctx,
			spec,
			service.options.maxDiscoveryDepth,
			service.options.maxDiscoveryDirs,
			service.options.maxDiscoveryEntries,
		)
		roots = append(roots, root)
		issues = append(issues, rootIssues...)
		for _, candidate := range candidates {
			key := physicalKey(candidate.parsed)
			existing, exists := physicalRecords[key]
			if !exists {
				physicalRecords[key] = candidate
				continue
			}
			existing.origins = append(existing.origins, candidate.origins...)
			if sourcePriority(candidate.parsed.summary.Source) < sourcePriority(existing.parsed.summary.Source) {
				origins := existing.origins
				existing = candidate
				existing.origins = origins
			}
			physicalRecords[key] = existing
		}
		if ctx.Err() != nil {
			break
		}
	}

	hostConfig, configIssue := loadConfig(hostCodexHome, joinDisplayPath(hostCodexDisplay, "config.toml"))
	if configIssue != nil {
		issues = append(issues, *configIssue)
	}

	records := make([]inventoryRecord, 0, len(physicalRecords))
	for key, record := range physicalRecords {
		sortOrigins(record.origins)
		record.parsed.summary.ID = stableSkillID(key)
		public := publicOrigins(record.origins)
		record.parsed.summary.Origins = public
		record.parsed.summary.AliasCount = len(public)
		record.parsed.summary.SamePhysicalCount = len(public)
		record.parsed.summary.Linked = anyLinked(record.origins)
		record.parsed.summary.Source = record.origins[0].Source
		record.parsed.summary.DisplayPath = record.origins[0].DisplayPath
		record.parsed.summary.Deprecated = record.origins[0].Deprecated
		record.parsed.absolutePath = record.origins[0].absolutePath
		record.parsed.resolvedPath = record.origins[0].resolvedPath
		records = append(records, record)
	}

	nameCounts := map[string]int{}
	for _, record := range records {
		nameCounts[record.parsed.summary.Name]++
	}
	for index := range records {
		records[index].parsed.summary.SameNameCount = nameCounts[records[index].parsed.summary.Name]
		applyAvailability(&records[index], hostConfig, runtimeIsolated, runtimeUnknown, home, hostCodexHome)
	}
	sortInventoryRecords(records)

	response := ListResponse{
		GeneratedAt: service.options.Now().UTC().Format(time.RFC3339),
		Roots:       roots,
		Issues:      issues,
		Skills:      make([]SkillSummary, 0, len(records)),
	}
	recordMap := make(map[string]inventoryRecord, len(records))
	for _, record := range records {
		summary := record.parsed.summary
		response.Skills = append(response.Skills, summary)
		recordMap[summary.ID] = record
	}
	response.Summary = summarize(response.Skills)
	return inventoryScan{response: response, records: recordMap}, nil
}

func scanRoot(
	ctx context.Context,
	spec rootSpec,
	depthLimit int,
	dirLimit int,
	entryLimit int,
) (Root, []inventoryRecord, []Issue) {
	displayRoot := spec.displayRoot
	root := Root{
		Source:         spec.source,
		DisplayPath:    displayRoot,
		MediaGoVisible: spec.mediaGoVisible,
		Deprecated:     spec.deprecated,
	}
	info, err := os.Lstat(spec.path)
	if errors.Is(err, os.ErrNotExist) {
		return root, []inventoryRecord{}, []Issue{}
	}
	if err != nil {
		return unreadableRoot(root, spec.source, displayRoot, "无法检查 Skill 来源。")
	}
	root.Exists = true
	if info.Mode()&os.ModeSymlink != 0 && !spec.followSymlinks {
		return unreadableRoot(root, spec.source, displayRoot, "系统 Skill 来源为符号链接，已按安全规则跳过。")
	}
	resolvedInfo, err := os.Stat(spec.path)
	if err != nil || !resolvedInfo.IsDir() {
		return unreadableRoot(root, spec.source, displayRoot, "Skill 来源不是可读取目录。")
	}

	candidates := []inventoryRecord{}
	issues := []Issue{}
	dirsSeen := 0
	entriesSeen := 0
	limitReported := false
	scanStopped := false
	rootRead := false
	reportLimit := func(message string, path string) {
		if !limitReported {
			issues = append(issues, Issue{
				Code:        IssueRootScanLimit,
				Message:     message,
				Source:      spec.source,
				DisplayPath: path,
			})
			limitReported = true
		}
		scanStopped = true
	}

	var walk func(string, int, map[string]struct{})
	walk = func(dir string, depth int, ancestors map[string]struct{}) {
		if scanStopped {
			return
		}
		if ctx.Err() != nil {
			reportLimit("Skill 来源扫描已取消，结果可能不完整。", displayPathForRoot(spec, dir))
			return
		}
		if dirsSeen >= dirLimit {
			reportLimit("Skill 来源达到扫描目录上限，结果可能不完整。", displayRoot)
			return
		}
		dirsSeen++
		skillPath := filepath.Join(dir, "SKILL.md")
		if skillInfo, skillErr := os.Lstat(skillPath); skillErr == nil && skillInfo.Mode().IsRegular() {
			parsed := parseSkillDirectory(spec.source, dir, displayPathForRoot(spec, dir), "")
			parsed.raw = ""
			origin := originRecord{
				SkillOrigin: SkillOrigin{
					Source:      spec.source,
					DisplayPath: parsed.summary.DisplayPath,
					Linked:      parsed.summary.Linked,
					Deprecated:  spec.deprecated,
				},
				absolutePath: parsed.absolutePath,
				resolvedPath: parsed.resolvedPath,
			}
			candidates = append(candidates, inventoryRecord{parsed: parsed, origins: []originRecord{origin}})
		}
		if depth >= depthLimit {
			return
		}
		entries, readErr := os.ReadDir(dir)
		if readErr != nil {
			issues = append(issues, Issue{
				Code:        IssueRootUnreadable,
				Message:     "无法读取 Skill 来源中的子目录。",
				Source:      spec.source,
				DisplayPath: displayPathForRoot(spec, dir),
			})
			return
		}
		if depth == 0 {
			rootRead = true
		}
		for _, entry := range entries {
			if entriesSeen >= entryLimit {
				reportLimit("Skill 来源达到扫描条目上限，结果可能不完整。", displayRoot)
				return
			}
			entriesSeen++
			if ctx.Err() != nil {
				reportLimit("Skill 来源扫描已取消，结果可能不完整。", displayPathForRoot(spec, dir))
				return
			}
			name := entry.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			if spec.skipSystemContainer && depth == 0 && name == ".system" {
				continue
			}
			child := filepath.Join(dir, name)
			isSymlink := entry.Type()&os.ModeSymlink != 0
			if isSymlink && !spec.followSymlinks {
				continue
			}
			childInfo, statErr := os.Stat(child)
			if statErr != nil {
				if isSymlink {
					issues = append(issues, Issue{
						Code:        IssueBrokenSymlink,
						Message:     "Skill 来源包含无法解析的符号链接。",
						Source:      spec.source,
						DisplayPath: displayPathForRoot(spec, child),
					})
				}
				continue
			}
			if !childInfo.IsDir() {
				continue
			}
			canonical, canonicalErr := filepath.EvalSymlinks(child)
			if canonicalErr != nil {
				canonical = child
			}
			canonical, _ = filepath.Abs(canonical)
			canonical = filepath.Clean(canonical)
			if _, cyclic := ancestors[canonical]; cyclic {
				issues = append(issues, Issue{
					Code:        IssueBrokenSymlink,
					Message:     "Skill 来源包含循环符号链接，已跳过。",
					Source:      spec.source,
					DisplayPath: displayPathForRoot(spec, child),
				})
				continue
			}
			nextAncestors := clonePathSet(ancestors)
			nextAncestors[canonical] = struct{}{}
			walk(child, depth+1, nextAncestors)
		}
	}
	rootCanonical, _ := filepath.EvalSymlinks(spec.path)
	rootCanonical, _ = filepath.Abs(rootCanonical)
	walk(spec.path, 0, map[string]struct{}{filepath.Clean(rootCanonical): {}})
	root.Readable = rootRead
	if !root.Readable {
		root.Error = "无法读取此来源。"
	}
	return root, candidates, issues
}

func unreadableRoot(root Root, source Source, display string, message string) (Root, []inventoryRecord, []Issue) {
	root.Readable = false
	root.Error = message
	return root, []inventoryRecord{}, []Issue{{
		Code:        IssueRootUnreadable,
		Message:     message,
		Source:      source,
		DisplayPath: display,
	}}
}

func loadConfig(codexHome string, displayConfigPath string) (configState, *Issue) {
	path := filepath.Join(codexHome, "config.toml")
	data, err := readCappedFile(path, maxConfigFileBytes)
	if errors.Is(err, os.ErrNotExist) {
		return configState{}, nil
	}
	if err != nil {
		return configState{problem: ReasonConfigUnreadable}, &Issue{
			Code:        IssueConfigUnreadable,
			Message:     "无法读取本机 Codex config.toml。",
			Source:      SourceCodexHome,
			DisplayPath: displayConfigPath,
		}
	}
	var document configDocument
	if err := toml.Unmarshal(data, &document); err != nil {
		return configState{problem: ReasonConfigInvalid}, &Issue{
			Code:        IssueConfigInvalid,
			Message:     "本机 Codex config.toml 不是有效的 TOML。",
			Source:      SourceCodexHome,
			DisplayPath: displayConfigPath,
		}
	}
	return configState{
		rules:          document.Skills.Config,
		bundledEnabled: document.Skills.Bundled.Enabled,
	}, nil
}

func applyAvailability(record *inventoryRecord, hostConfig configState, runtimeIsolated bool, runtimeUnknown bool, home string, hostCodexHome string) {
	summary := &record.parsed.summary
	if !summary.Valid {
		diagnostic := SurfaceDiagnostic{
			State:      AvailabilityInvalid,
			ReasonCode: ReasonInvalidSkill,
			Message:    "SKILL.md 元数据无效。",
		}
		summary.AppCLI = diagnostic
		summary.MediaGo = diagnostic
		return
	}
	if productsExcludeCodex(summary.Products) {
		diagnostic := SurfaceDiagnostic{
			State:      AvailabilityUnknown,
			ReasonCode: ReasonProductRestricted,
			Message:    "Skill 产品策略未包含 Codex。",
		}
		summary.AppCLI = diagnostic
		summary.MediaGo = diagnostic
		return
	}

	summary.AppCLI = baseHostDiagnostic(summary.Source)
	if hostConfig.problem != "" {
		summary.AppCLI = SurfaceDiagnostic{
			State:      AvailabilityUnknown,
			ReasonCode: hostConfig.problem,
			Message:    "无法根据本机 Codex 配置确认可用性。",
		}
	} else if onlySystemOrigins(record.origins) && hostConfig.bundledEnabled != nil && !*hostConfig.bundledEnabled {
		summary.AppCLI = SurfaceDiagnostic{
			State:      AvailabilityDisabled,
			ReasonCode: ReasonBundledDisabled,
			Message:    "本机 Codex 配置已禁用内置 Skill。",
		}
	} else if enabled, matched := matchingRule(record, hostConfig.rules, home, hostCodexHome); matched && !enabled {
		summary.AppCLI = SurfaceDiagnostic{
			State:      AvailabilityDisabled,
			ReasonCode: ReasonDisabledByConfig,
			Message:    "本机 Codex 配置已禁用此 Skill。",
		}
	}

	if runtimeUnknown {
		summary.MediaGo = SurfaceDiagnostic{
			State:      AvailabilityUnknown,
			ReasonCode: ReasonRuntimeHomeUnknown,
			Message:    "无法确认 MediaGo Codex 运行时可用性。",
		}
		return
	}
	if !runtimeIsolated {
		summary.MediaGo = summary.AppCLI
		return
	}
	if hasRuntimeSharedOrigin(record.origins) {
		reason := ReasonUserShared
		message := "位于 Codex 共享用户目录，MediaGo 预计可用。"
		if !hasOrigin(record.origins, SourceUserShared) {
			reason = ReasonAdmin
			message = "位于管理员 Skill 目录，MediaGo 预计可用。"
		}
		summary.MediaGo = SurfaceDiagnostic{
			State:      AvailabilityAvailable,
			ReasonCode: reason,
			Message:    message,
		}
		return
	}
	if hasOrigin(record.origins, SourceCodexHome) {
		summary.MediaGo = SurfaceDiagnostic{
			State:      AvailabilityNotShared,
			ReasonCode: ReasonRuntimeHomeIsolated,
			Message:    "MediaGo 使用隔离 Codex Home，无法发现此兼容目录入口。",
		}
		return
	}
	summary.MediaGo = SurfaceDiagnostic{
		State:      AvailabilityUnknown,
		ReasonCode: ReasonSystemRuntimeUnconfirmed,
		Message:    "无法从本机静态扫描确认隔离运行时的内置 Skill。",
	}
}

func baseHostDiagnostic(source Source) SurfaceDiagnostic {
	switch source {
	case SourceUserShared:
		return SurfaceDiagnostic{State: AvailabilityAvailable, ReasonCode: ReasonUserShared, Message: "本机 Codex 可发现共享用户 Skill。"}
	case SourceCodexHome:
		return SurfaceDiagnostic{State: AvailabilityAvailable, ReasonCode: ReasonCodexHome, Message: "本机 Codex 可发现兼容目录 Skill。"}
	case SourceAdmin:
		return SurfaceDiagnostic{State: AvailabilityAvailable, ReasonCode: ReasonAdmin, Message: "本机 Codex 可发现管理员 Skill。"}
	default:
		return SurfaceDiagnostic{State: AvailabilityAvailable, ReasonCode: ReasonSystem, Message: "本机 Codex 可发现当前安装的内置 Skill。"}
	}
}

func matchingRule(record *inventoryRecord, rules []configRule, home string, codexHome string) (bool, bool) {
	enabled := false
	matched := false
	for _, rule := range rules {
		pathSelector := strings.TrimSpace(rule.Path)
		nameSelector := strings.TrimSpace(rule.Name)
		if rule.Enabled == nil || (pathSelector == "") == (nameSelector == "") {
			continue
		}
		matches := nameSelector != "" && nameSelector == record.parsed.summary.Name
		if pathSelector != "" {
			matches = rulePathMatches(pathSelector, record, home, codexHome)
		}
		if matches {
			enabled = *rule.Enabled
			matched = true
		}
	}
	return enabled, matched
}

func rulePathMatches(selector string, record *inventoryRecord, home string, codexHome string) bool {
	selectorPath := canonicalConfigPath(selector, home, codexHome)
	if selectorPath == "" {
		return false
	}
	for _, origin := range record.origins {
		targetPath := origin.resolvedPath
		if targetPath == "" {
			targetPath = origin.absolutePath
		}
		if canonicalConfigPath(targetPath, home, codexHome) == selectorPath {
			return true
		}
	}
	return false
}

func canonicalConfigPath(path string, home string, base string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	if path == "~" || strings.HasPrefix(path, "~"+string(filepath.Separator)) {
		path = filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(path, "~"), string(filepath.Separator)))
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	if resolved, resolveErr := filepath.EvalSymlinks(absolute); resolveErr == nil {
		absolute = resolved
	}
	return comparablePath(absolute)
}

func productsExcludeCodex(products []string) bool {
	if len(products) == 0 {
		return false
	}
	for _, product := range products {
		if strings.EqualFold(strings.TrimSpace(product), "codex") {
			return false
		}
	}
	return true
}

func summarize(skills []SkillSummary) Summary {
	summary := Summary{Total: len(skills)}
	for _, skill := range skills {
		if skill.MediaGo.State == AvailabilityAvailable {
			summary.MediaGoAvailable++
		}
		if skill.AppCLI.State == AvailabilityUnknown || skill.MediaGo.State == AvailabilityUnknown {
			summary.Unknown++
		}
		if skill.AppCLI.State == AvailabilityDisabled ||
			skill.MediaGo.State == AvailabilityDisabled ||
			skill.MediaGo.State == AvailabilityNotShared ||
			skill.AppCLI.State == AvailabilityInvalid ||
			skill.MediaGo.State == AvailabilityInvalid {
			summary.NeedsAttention++
		}
	}
	return summary
}

func physicalKey(parsed parsedSkill) string {
	if parsed.resolvedPath != "" {
		return comparablePath(parsed.resolvedPath)
	}
	return comparablePath(parsed.absolutePath)
}

func stableSkillID(key string) string {
	digest := sha256.Sum256([]byte(filepath.Clean(key)))
	return skillIDPrefix + hex.EncodeToString(digest[:16])
}

func validSkillID(id string) bool {
	if len(id) != len(skillIDPrefix)+skillIDHexLength || !strings.HasPrefix(id, skillIDPrefix) {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(id, skillIDPrefix))
	return err == nil
}

func displayPath(path string, home string) string {
	path = filepath.Clean(path)
	home = filepath.Clean(home)
	relative, err := filepath.Rel(home, path)
	if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		if relative == "." {
			return "~"
		}
		return joinDisplayPath("~", filepath.ToSlash(relative))
	}
	return path
}

func displayPathForRoot(spec rootSpec, value string) string {
	relative, err := filepath.Rel(spec.path, value)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return spec.displayRoot
	}
	if relative == "." {
		return spec.displayRoot
	}
	return joinDisplayPath(spec.displayRoot, filepath.ToSlash(relative))
}

func joinDisplayPath(base string, elements ...string) string {
	parts := make([]string, 0, len(elements)+1)
	parts = append(parts, base)
	parts = append(parts, elements...)
	return slashpath.Join(parts...)
}

func absoluteFrom(base string, value string) (string, error) {
	value = strings.TrimSpace(value)
	if !filepath.IsAbs(value) {
		value = filepath.Join(base, value)
	}
	return filepath.Abs(value)
}

func sortOrigins(origins []originRecord) {
	sort.SliceStable(origins, func(left int, right int) bool {
		leftPriority := sourcePriority(origins[left].Source)
		rightPriority := sourcePriority(origins[right].Source)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		return origins[left].DisplayPath < origins[right].DisplayPath
	})
}

func publicOrigins(origins []originRecord) []SkillOrigin {
	result := make([]SkillOrigin, 0, len(origins))
	seen := map[string]struct{}{}
	for _, origin := range origins {
		key := string(origin.Source) + "\x00" + origin.DisplayPath
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, origin.SkillOrigin)
	}
	return result
}

func sourcePriority(source Source) int {
	switch source {
	case SourceUserShared:
		return 0
	case SourceCodexHome:
		return 1
	case SourceSystem:
		return 2
	case SourceAdmin:
		return 3
	default:
		return 4
	}
}

func sortInventoryRecords(records []inventoryRecord) {
	sort.SliceStable(records, func(left int, right int) bool {
		leftSummary := records[left].parsed.summary
		rightSummary := records[right].parsed.summary
		leftAvailable := leftSummary.MediaGo.State == AvailabilityAvailable
		rightAvailable := rightSummary.MediaGo.State == AvailabilityAvailable
		if leftAvailable != rightAvailable {
			return leftAvailable
		}
		leftPriority := sourcePriority(leftSummary.Source)
		rightPriority := sourcePriority(rightSummary.Source)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		leftName := strings.ToLower(displayName(leftSummary))
		rightName := strings.ToLower(displayName(rightSummary))
		if leftName != rightName {
			return leftName < rightName
		}
		return leftSummary.DisplayPath < rightSummary.DisplayPath
	})
}

func displayName(summary SkillSummary) string {
	if strings.TrimSpace(summary.DisplayName) != "" {
		return summary.DisplayName
	}
	return summary.Name
}

func anyLinked(origins []originRecord) bool {
	for _, origin := range origins {
		if origin.Linked {
			return true
		}
	}
	return false
}

func hasOrigin(origins []originRecord, source Source) bool {
	for _, origin := range origins {
		if origin.Source == source {
			return true
		}
	}
	return false
}

func onlySystemOrigins(origins []originRecord) bool {
	return len(origins) > 0 && !hasOrigin(origins, SourceUserShared) && !hasOrigin(origins, SourceCodexHome) && !hasOrigin(origins, SourceAdmin)
}

func hasRuntimeSharedOrigin(origins []originRecord) bool {
	return hasOrigin(origins, SourceUserShared) || hasOrigin(origins, SourceAdmin)
}

func clonePathSet(paths map[string]struct{}) map[string]struct{} {
	clone := make(map[string]struct{}, len(paths)+1)
	for path := range paths {
		clone[path] = struct{}{}
	}
	return clone
}

func comparablePath(path string) string {
	path = filepath.Clean(path)
	if runtime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}
