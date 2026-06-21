package pack

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ArchiveDir zips every file under dir and returns the raw zip bytes.
func ArchiveDir(ctx context.Context, dir string) ([]byte, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, fmt.Errorf("%w: archive directory is required", ErrInvalidPack)
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctxErr(ctx); err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if strings.HasPrefix(relative, ".") && relative != "pack.json" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = relative
		header.Method = zip.Deflate
		target, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}
		source, err := os.Open(path)
		if err != nil {
			return err
		}
		defer source.Close()
		if _, err := io.Copy(target, source); err != nil {
			return err
		}
		return nil
	})
	if closeErr := writer.Close(); err == nil && closeErr != nil {
		err = closeErr
	}
	if err != nil {
		return nil, fmt.Errorf("archiving pack directory: %w", err)
	}
	return buffer.Bytes(), nil
}

// ParseZip parses a prompt pack from raw zip bytes.
func ParseZip(ctx context.Context, data []byte) (Bundle, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Bundle{}, fmt.Errorf("%w: opening zip: %w", ErrInvalidPack, err)
	}
	return ParseFS(ctx, reader)
}

// UnpackZip writes raw zip bytes to dir.
func UnpackZip(ctx context.Context, data []byte, dir string) error {
	if err := ctxErr(ctx); err != nil {
		return err
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("%w: opening zip: %w", ErrInvalidPack, err)
	}
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return fmt.Errorf("%w: output directory is required", ErrInvalidPack)
	}
	for _, file := range reader.File {
		if err := ctxErr(ctx); err != nil {
			return err
		}
		clean := filepath.Clean(file.Name)
		if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			return fmt.Errorf("%w: unsafe zip path %q", ErrInvalidPack, file.Name)
		}
		targetPath := filepath.Join(dir, filepath.FromSlash(clean))
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, 0o755); err != nil {
				return fmt.Errorf("creating directory %s: %w", targetPath, err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return fmt.Errorf("creating directory for %s: %w", targetPath, err)
		}
		source, err := file.Open()
		if err != nil {
			return fmt.Errorf("opening %s: %w", file.Name, err)
		}
		target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
		if err != nil {
			source.Close()
			return fmt.Errorf("creating %s: %w", targetPath, err)
		}
		_, copyErr := io.Copy(target, source)
		closeSourceErr := source.Close()
		closeTargetErr := target.Close()
		if copyErr != nil {
			return fmt.Errorf("writing %s: %w", targetPath, copyErr)
		}
		if closeSourceErr != nil {
			return fmt.Errorf("closing source %s: %w", file.Name, closeSourceErr)
		}
		if closeTargetErr != nil {
			return fmt.Errorf("closing %s: %w", targetPath, closeTargetErr)
		}
	}
	return nil
}
