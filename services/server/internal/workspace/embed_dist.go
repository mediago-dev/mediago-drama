//go:build workspace_dist

package workspace

import (
	"embed"
	"io/fs"
)

// content contains the built workspace app.
//
//go:embed dist
var content embed.FS

// StaticFS returns the embedded workspace static assets.
func StaticFS() (fs.FS, error) {
	return fs.Sub(content, "dist")
}
