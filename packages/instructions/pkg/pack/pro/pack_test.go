package pro

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
)

func TestBuildAndParseRoundTrip(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")

	raw, err := Build(ctx, plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
		Payload: PayloadMeta{},
	}, key)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	manifest, bundle, err := Parse(ctx, raw, key)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if manifest.ID != "com.example.pro.test" || manifest.Payload.Size <= 0 {
		t.Fatalf("manifest = %#v, want valid id and positive payload size", manifest)
	}
	if bundle.Manifest.ID != "com.example.pro.test" {
		t.Fatalf("bundle manifest = %#v, want pack id", bundle.Manifest)
	}
	if manifest.Encryption.Algorithm != defaultEncryptionAlgorithm {
		t.Fatalf("manifest algorithm = %q, want %q", manifest.Encryption.Algorithm, defaultEncryptionAlgorithm)
	}
}

func TestInspectRejectsNonProData(t *testing.T) {
	t.Helper()
	if _, err := Inspect(context.Background(), []byte("not a pack")); err == nil {
		t.Fatal("Inspect() error = nil, want error")
	}
}

func TestParseRejectsWrongKey(t *testing.T) {
	t.Helper()
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	raw, err := Build(context.Background(), plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
	}, key)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	_, _, err = Parse(context.Background(), raw, []byte("invalid-key-size"))
	if !errors.Is(err, ErrMissingKey) {
		t.Fatalf("Parse() error = %v, want ErrMissingKey", err)
	}
}

func TestParseRejectsManifestTampering(t *testing.T) {
	t.Helper()
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	raw, err := Build(context.Background(), plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
	}, key)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	tampered, err := tamperManifest(raw, func(manifest *Manifest) {
		manifest.RequiredEntitlement = "pack.other"
	})
	if err != nil {
		t.Fatalf("tamperManifest() error = %v", err)
	}
	_, _, err = Parse(context.Background(), tampered, key)
	if !errors.Is(err, ErrInvalidProPack) {
		t.Fatalf("Parse(tampered) error = %v, want ErrInvalidProPack", err)
	}
}

func newTestPackArchive(t *testing.T) []byte {
	t.Helper()
	root := t.TempDir()
	packJSON := `{"id":"com.example.pro.test","name":"Pro Test Pack","version":"1.0.0"}`
	if err := writeTestFile(filepath.Join(root, "pack.json"), []byte(packJSON)); err != nil {
		t.Fatalf("write pack.json: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "skills"), 0o755); err != nil {
		t.Fatalf("make skills dir: %v", err)
	}
	if err := writeTestFile(filepath.Join(root, "skills", "pro-skill.skill.md"), []byte(`---
name: pro-skill
description: Pro skill
---
Use this for tests.
`)); err != nil {
		t.Fatalf("write skill: %v", err)
	}
	archive, err := instructionpack.ArchiveDir(context.Background(), root)
	if err != nil {
		t.Fatalf("ArchiveDir() error = %v", err)
	}
	return archive
}

func writeTestFile(path string, data []byte) error {
	return os.WriteFile(path, data, 0o644)
}

func tamperManifest(raw []byte, mutate func(*Manifest)) ([]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, err
	}
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, file := range reader.File {
		open, err := file.Open()
		if err != nil {
			return nil, err
		}
		content, err := io.ReadAll(open)
		_ = open.Close()
		if err != nil {
			return nil, err
		}
		if file.Name == manifestFile {
			var manifest Manifest
			if err := json.Unmarshal(content, &manifest); err != nil {
				return nil, err
			}
			mutate(&manifest)
			content, err = json.Marshal(manifest)
			if err != nil {
				return nil, err
			}
		}
		outFile, err := writer.Create(file.Name)
		if err != nil {
			return nil, err
		}
		if _, err := outFile.Write(content); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
