package shared

import (
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"strings"
)

const (
	// AssetKindImage identifies image files.
	AssetKindImage = "image"
	// AssetKindVideo identifies video files.
	AssetKindVideo = "video"
	// AssetKindAudio identifies audio files.
	AssetKindAudio = "audio"
	// AssetKindText identifies textual reference files.
	AssetKindText = "text"
	// AssetKindBinary identifies opaque files.
	AssetKindBinary = "binary"
)

// ReadLimited reads up to limit bytes and reports an error when the reader is larger.
func ReadLimited(reader io.Reader, limit int64) ([]byte, error) {
	limited := io.LimitReader(reader, limit+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("asset is larger than %d bytes", limit)
	}

	return data, nil
}

// KindFromMIMEType maps a MIME type to the local asset kind taxonomy.
func KindFromMIMEType(mimeType string) string {
	mimeType = NormalizeMIMEType(mimeType)
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return AssetKindImage
	case strings.HasPrefix(mimeType, "video/"):
		return AssetKindVideo
	case strings.HasPrefix(mimeType, "audio/"):
		return AssetKindAudio
	case strings.HasPrefix(mimeType, "text/"),
		mimeType == "application/json",
		mimeType == "application/xml":
		return AssetKindText
	default:
		return AssetKindBinary
	}
}

// NormalizeMIMEType strips parameters and lowercases a MIME type.
func NormalizeMIMEType(mimeType string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
}

// SafeFilename returns a path-safe filename basename.
func SafeFilename(filename string) string {
	filename = strings.TrimSpace(filepath.Base(filename))
	if filename == "." || filename == string(filepath.Separator) {
		return ""
	}

	return strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '-'
		default:
			return r
		}
	}, filename)
}

// ExtensionForMIMEType returns a practical file extension for a MIME type.
func ExtensionForMIMEType(mimeType string) string {
	normalized := NormalizeMIMEType(mimeType)
	switch normalized {
	case "audio/mpeg":
		return ".mp3"
	case "audio/mp4", "audio/x-m4a":
		return ".m4a"
	case "audio/wav", "audio/wave", "audio/x-wav":
		return ".wav"
	case "audio/webm":
		return ".webm"
	}
	if extensions, err := mime.ExtensionsByType(normalized); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	switch normalized {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "application/pdf":
		return ".pdf"
	default:
		return ".bin"
	}
}
