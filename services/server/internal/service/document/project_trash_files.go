package document

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/shared"
)

var renameDirectory = os.Rename

// projectDirExists reports whether the given project directory currently exists on disk.
// A project whose directory was moved or deleted externally must still be deletable, so
// callers use this to decide whether there are any files to relocate.
func projectDirExists(dir string) bool {
	dir = shared.ResolveWorkspaceDir(dir)
	if dir == "" {
		return false
	}
	info, err := os.Stat(dir)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func moveProjectDirToTrash(workspaceDir string, projectDir string, projectID string, projectName string, now string) (string, error) {
	workspaceDir = shared.ResolveWorkspaceDir(workspaceDir)
	projectDir = shared.ResolveWorkspaceDir(projectDir)
	projectID = strings.TrimSpace(projectID)
	if workspaceDir == "" {
		return "", fmt.Errorf("workspaceDir is required")
	}
	if projectDir == "" {
		return "", fmt.Errorf("projectDir is required")
	}
	if projectID == "" {
		return "", fmt.Errorf("projectID is required")
	}
	info, err := os.Stat(projectDir)
	if err != nil {
		return "", fmt.Errorf("checking project directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("projectDir is not a directory: %s", projectDir)
	}

	trashRoot := filepath.Join(shared.ProjectMetadataDir(workspaceDir), "trash", "projects")
	stamp := compactTrashTimestamp(now)
	name := strings.Join([]string{stamp, projectID, safeTrashProjectName(projectName)}, "-")
	target := uniqueFilesystemPath(filepath.Join(trashRoot, name))
	if isPathWithin(target, projectDir) {
		return "", fmt.Errorf("project trash path cannot be inside the project directory")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", fmt.Errorf("creating project trash directory: %w", err)
	}
	if err := moveDirectory(projectDir, target); err != nil {
		return "", err
	}
	return target, nil
}

func restoreProjectDirFromTrash(trashProjectDir string, originalProjectDir string, now string) (string, error) {
	trashProjectDir = shared.ResolveWorkspaceDir(trashProjectDir)
	originalProjectDir = shared.ResolveWorkspaceDir(originalProjectDir)
	if trashProjectDir == "" {
		return "", fmt.Errorf("trashProjectDir is required")
	}
	if originalProjectDir == "" {
		return "", fmt.Errorf("originalProjectDir is required")
	}
	info, err := os.Stat(trashProjectDir)
	if err != nil {
		return "", fmt.Errorf("checking trashed project directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("trashProjectDir is not a directory: %s", trashProjectDir)
	}

	target := originalProjectDir
	if _, err := os.Stat(target); err == nil {
		target = restoredProjectDirCandidate(originalProjectDir, now)
	} else if err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("checking original project directory: %w", err)
	}
	target = uniqueFilesystemPath(target)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", fmt.Errorf("creating restored project parent directory: %w", err)
	}
	if err := moveDirectory(trashProjectDir, target); err != nil {
		return "", err
	}
	return target, nil
}

func moveDirectory(source string, target string) error {
	source = shared.ResolveWorkspaceDir(source)
	target = shared.ResolveWorkspaceDir(target)
	if source == "" || target == "" {
		return fmt.Errorf("source and target are required")
	}
	if err := renameDirectory(source, target); err == nil {
		return nil
	}
	if err := copyDirectory(source, target); err != nil {
		return fmt.Errorf("copying directory to %s: %w", target, err)
	}
	if err := os.RemoveAll(source); err != nil {
		return fmt.Errorf("removing original directory %s: %w", source, err)
	}
	return nil
}

func copyDirectory(source string, target string) error {
	source = shared.ResolveWorkspaceDir(source)
	target = shared.ResolveWorkspaceDir(target)
	info, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("checking source directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("source is not a directory: %s", source)
	}
	if _, err := os.Stat(target); err == nil {
		return fmt.Errorf("target already exists: %s", target)
	} else if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("checking target directory: %w", err)
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		dest := filepath.Join(target, relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(dest, info.Mode().Perm())
		}
		if info.Mode()&os.ModeSymlink != 0 {
			linkTarget, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(linkTarget, dest)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copyRegularFile(path, dest, info.Mode().Perm())
	})
}

func copyRegularFile(source string, target string, mode fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func safeTrashProjectName(projectName string) string {
	projectName = strings.TrimSpace(projectName)
	if projectName == "" {
		return "project"
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, char := range projectName {
		switch {
		case unicode.IsLetter(char) || unicode.IsDigit(char):
			builder.WriteRune(char)
			lastUnderscore = false
		case char == '-' || char == '.':
			builder.WriteRune(char)
			lastUnderscore = false
		default:
			if !lastUnderscore {
				builder.WriteByte('_')
				lastUnderscore = true
			}
		}
	}
	value := strings.Trim(builder.String(), "_.-")
	if value == "" {
		return "project"
	}
	if len(value) > 80 {
		value = value[:80]
	}
	return value
}

func compactTrashTimestamp(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	if err != nil {
		parsed = time.Now().UTC()
	}
	return parsed.UTC().Format("20060102T150405Z")
}

func restoredProjectDirCandidate(originalProjectDir string, now string) string {
	dir := filepath.Dir(originalProjectDir)
	base := filepath.Base(originalProjectDir)
	return filepath.Join(dir, fmt.Sprintf("%s-restored-%s", base, compactTrashTimestamp(now)))
}

func uniqueFilesystemPath(path string) string {
	path = shared.ResolveWorkspaceDir(path)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}
	extension := filepath.Ext(path)
	stem := strings.TrimSuffix(path, extension)
	for index := 2; ; index++ {
		candidate := fmt.Sprintf("%s-%d%s", stem, index, extension)
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
}

func isPathWithin(path string, parent string) bool {
	path = shared.ResolveWorkspaceDir(path)
	parent = shared.ResolveWorkspaceDir(parent)
	relative, err := filepath.Rel(parent, path)
	if err != nil {
		return false
	}
	return relative == "." || (!strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != "..")
}
