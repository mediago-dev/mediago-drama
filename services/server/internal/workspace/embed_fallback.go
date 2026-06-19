//go:build !workspace_dist

package workspace

import (
	"embed"
	"io/fs"
)

// content contains a fallback page for development builds without workspace dist.
//
//go:embed fallback
var content embed.FS

// StaticFS returns the embedded fallback static assets.
func StaticFS() (fs.FS, error) {
	return fs.Sub(content, "fallback")
}
