// Package configs embeds default configuration assets for the CLI.
package configs

import (
	"embed"
	"os"
	"path/filepath"
)

// PromptTemplates embeds the default system prompt template Markdown files.
//
//go:embed templates/prompts/*.md
var PromptTemplates embed.FS

// Skills embeds the built-in agent skill Markdown files.
//
//go:embed skills/builtin/*.skill.md
var Skills embed.FS

// StylePresets embeds the built-in visual style preset Markdown files.
//
//go:embed style-presets/builtin/*.md
var StylePresets embed.FS

// PromptLibrary embeds the built-in reusable generation prompt Markdown files.
//
//go:embed prompt-library/builtin/*.md
var PromptLibrary embed.FS

// VoicePreviews embeds built-in voice preview audio files and their manifest.
//
//go:embed voice-previews
var VoicePreviews embed.FS

// ReadPromptTemplate reads an editable prompt template, preferring source files over embedded defaults.
func ReadPromptTemplate(name string) ([]byte, error) {
	sourcePath := filepath.Join(SourceTemplateDir("prompts"), name)
	if data, err := os.ReadFile(sourcePath); err == nil {
		return data, nil
	}
	return PromptTemplates.ReadFile(filepath.ToSlash(filepath.Join("templates", "prompts", name)))
}

// SourceTemplateDir returns the writable source directory for editable templates.
func SourceTemplateDir(kind string) string {
	localDir := filepath.Join("configs", "templates", kind)
	workspaceDir := filepath.Join("packages", "cli", localDir)
	if _, err := os.Stat(workspaceDir); err == nil {
		return workspaceDir
	}
	return localDir
}

// SourceSkillDir returns the writable source directory for user-defined skills.
func SourceSkillDir(kind string) string {
	localDir := filepath.Join("configs", "skills", kind)
	workspaceDir := filepath.Join("packages", "cli", localDir)
	if _, err := os.Stat(workspaceDir); err == nil {
		return workspaceDir
	}
	return localDir
}

// SourceStylePresetDir returns the writable source directory for visual style presets.
func SourceStylePresetDir(kind string) string {
	localDir := filepath.Join("configs", "style-presets", kind)
	workspaceDir := filepath.Join("packages", "cli", localDir)
	if _, err := os.Stat(workspaceDir); err == nil {
		return workspaceDir
	}
	return localDir
}
