package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/media"
)

func main() {
	var options media.AssetMigrationOptions
	flag.BoolVar(&options.Apply, "apply", false, "move files and update the SQLite database")
	flag.StringVar(&options.WorkspaceDir, "workspace", "", "MediaGo Drama workspace directory")
	flag.StringVar(&options.ManifestPath, "manifest", "", "migration manifest JSON path")
	flag.Parse()

	report, err := media.RunAssetMigration(context.Background(), options)
	if err != nil {
		fmt.Fprintln(os.Stderr, "asset migration failed:", err)
		os.Exit(1)
	}

	mode := "dry-run"
	if report.Apply {
		mode = "apply"
	}
	fmt.Printf("asset migration %s complete\n", mode)
	fmt.Printf("workspace: %s\n", report.WorkspaceDir)
	fmt.Printf("database: %s\n", report.DatabasePath)
	if report.BackupPath != "" {
		fmt.Printf("backup: %s\n", report.BackupPath)
	}
	fmt.Printf("manifest: %s\n", report.ManifestPath)
	fmt.Printf("entries: %d moved: %d updated: %d missing: %d errors: %d\n",
		len(report.Entries),
		report.Moved,
		report.Updated,
		report.Missing,
		report.Errors,
	)
	if !report.Apply {
		fmt.Println("rerun with --apply to move files and update media_assets")
	}
	if report.Errors > 0 {
		os.Exit(2)
	}
}
