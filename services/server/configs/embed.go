// Package configs embeds default configuration assets for the CLI.
package configs

import (
	"embed"
)

// VoicePreviews embeds built-in voice preview audio files and their manifest.
//
//go:embed voice-previews
var VoicePreviews embed.FS

// StylePresets embeds built-in visual style presets and their preview images.
//
//go:embed style-presets
var StylePresets embed.FS
