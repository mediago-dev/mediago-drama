// Package configs embeds default configuration assets for the CLI.
package configs

import (
	"embed"
)

// VoicePreviews embeds built-in voice preview audio files and their manifest.
//
//go:embed voice-previews
var VoicePreviews embed.FS
