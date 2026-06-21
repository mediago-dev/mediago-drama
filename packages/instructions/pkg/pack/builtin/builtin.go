// Package builtin exposes the built-in MediaGo prompt pack.
package builtin

import (
	"context"
	"embed"
	"fmt"
	"io/fs"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
)

//go:embed assets
var assets embed.FS

// FS returns the embedded built-in prompt pack filesystem.
func FS() embed.FS {
	return assets
}

// Builtin parses and returns the built-in prompt pack.
func Builtin(ctx context.Context) (pack.Bundle, error) {
	packFS, err := fs.Sub(assets, "assets")
	if err != nil {
		return pack.Bundle{}, fmt.Errorf("opening built-in prompt pack assets: %w", err)
	}
	bundle, err := pack.ParseFS(ctx, packFS)
	if err != nil {
		return pack.Bundle{}, fmt.Errorf("loading built-in prompt pack: %w", err)
	}
	return bundle, nil
}
