package handlers

import (
	"mime"
	"strings"
)

func contentDispositionWithFilename(disposition string, filename string) string {
	disposition = strings.TrimSpace(disposition)
	if disposition == "" {
		disposition = "inline"
	}
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return disposition
	}
	return mime.FormatMediaType(disposition, map[string]string{"filename": filename})
}
