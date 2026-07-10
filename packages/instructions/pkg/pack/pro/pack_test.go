package pro

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
)

func TestBuildAndParseRoundTrip(t *testing.T) {
	ctx := context.Background()
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	signer, publishers := newTestSigner(t)

	raw, err := Build(ctx, plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
		Payload: PayloadMeta{},
	}, key, signer)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	manifest, bundle, err := Parse(ctx, raw, key, publishers)
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

// TestBuildIgnoresSuppliedNonce guards against AES-GCM nonce reuse: a nonce
// smuggled in via the input manifest must never survive into the built pack.
func TestBuildIgnoresSuppliedNonce(t *testing.T) {
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	signer, publishers := newTestSigner(t)
	manifest := Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
		Encryption: Encryption{
			Nonce: "AAAAAAAAAAAAAAAA", // attacker-chosen fixed nonce
		},
	}
	first, err := Build(context.Background(), plain, manifest, key, signer)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	second, err := Build(context.Background(), plain, manifest, key, signer)
	if err != nil {
		t.Fatalf("Build() second error = %v", err)
	}
	firstManifest, err := Inspect(context.Background(), first, publishers)
	if err != nil {
		t.Fatalf("Inspect(first) error = %v", err)
	}
	secondManifest, err := Inspect(context.Background(), second, publishers)
	if err != nil {
		t.Fatalf("Inspect(second) error = %v", err)
	}
	if firstManifest.Encryption.Nonce == manifest.Encryption.Nonce {
		t.Fatal("Build() kept the caller-supplied nonce")
	}
	if firstManifest.Encryption.Nonce == secondManifest.Encryption.Nonce {
		t.Fatal("Build() reused a nonce across builds")
	}
}

func TestBuildRequiresSigner(t *testing.T) {
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	_, err := Build(context.Background(), plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
	}, key, Signer{})
	if !errors.Is(err, ErrInvalidProPack) {
		t.Fatalf("Build() error = %v, want ErrInvalidProPack", err)
	}
}

func TestInspectRejectsNonProData(t *testing.T) {
	_, publishers := newTestSigner(t)
	if _, err := Inspect(context.Background(), []byte("not a pack"), publishers); err == nil {
		t.Fatal("Inspect() error = nil, want error")
	}
}

func TestInspectRejectsEmptyKeyRing(t *testing.T) {
	raw, _, _ := newSignedTestPack(t)
	_, err := Inspect(context.Background(), raw, nil)
	if !errors.Is(err, ErrMissingPublisherKey) {
		t.Fatalf("Inspect() error = %v, want ErrMissingPublisherKey", err)
	}
}

func TestInspectRejectsUnknownPublisherKey(t *testing.T) {
	raw, _, _ := newSignedTestPack(t)
	otherPublic, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	_, err = Inspect(context.Background(), raw, KeyRing{"other-key": otherPublic})
	if !errors.Is(err, ErrMissingPublisherKey) {
		t.Fatalf("Inspect() error = %v, want ErrMissingPublisherKey", err)
	}
}

func TestParseRejectsWrongKey(t *testing.T) {
	raw, _, publishers := newSignedTestPack(t)
	_, _, err := Parse(context.Background(), raw, []byte("invalid-key-size"), publishers)
	if !errors.Is(err, ErrMissingKey) {
		t.Fatalf("Parse() error = %v, want ErrMissingKey", err)
	}
}

func TestParseRejectsManifestTampering(t *testing.T) {
	raw, key, publishers := newSignedTestPack(t)
	tampered, err := tamperManifest(raw, nil, func(manifest *Manifest) {
		manifest.RequiredEntitlement = "pack.other"
	})
	if err != nil {
		t.Fatalf("tamperManifest() error = %v", err)
	}
	_, _, err = Parse(context.Background(), tampered, key, publishers)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("Parse(tampered) error = %v, want ErrInvalidSignature", err)
	}
}

// TestParseRejectsResignedTampering simulates a compromised publisher
// signature: the manifest is tampered AND re-signed with the trusted key.
// The AES-GCM associated data still binds the payload to the original
// manifest bytes, so decryption must fail.
func TestParseRejectsResignedTampering(t *testing.T) {
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	signer, publishers := newTestSigner(t)
	raw, err := Build(context.Background(), plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
	}, key, signer)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	tampered, err := tamperManifest(raw, &signer, func(manifest *Manifest) {
		manifest.RequiredEntitlement = "pack.other"
	})
	if err != nil {
		t.Fatalf("tamperManifest() error = %v", err)
	}
	_, _, err = Parse(context.Background(), tampered, key, publishers)
	if !errors.Is(err, ErrInvalidProPack) {
		t.Fatalf("Parse(re-signed) error = %v, want ErrInvalidProPack", err)
	}
}

// TestParseRejectsForgedPack simulates an attacker who obtained the symmetric
// pack key and rebuilds a modified pack signed with their own key under the
// official key id. Verification against the trusted ring must fail.
func TestParseRejectsForgedPack(t *testing.T) {
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	_, publishers := newTestSigner(t)

	_, attackerPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	forged, err := Build(context.Background(), plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "6.6.6",
		KeyID:   "default",
	}, key, Signer{KeyID: testPublisherKeyID, Key: attackerPrivate})
	if err != nil {
		t.Fatalf("Build(forged) error = %v", err)
	}
	_, _, err = Parse(context.Background(), forged, key, publishers)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("Parse(forged) error = %v, want ErrInvalidSignature", err)
	}
}

func TestParseRejectsMissingSignatureFile(t *testing.T) {
	raw, key, publishers := newSignedTestPack(t)
	stripped, err := rewriteArchive(raw, func(name string, content []byte) ([]byte, bool) {
		if name == signatureFile {
			return nil, false
		}
		return content, true
	})
	if err != nil {
		t.Fatalf("rewriteArchive() error = %v", err)
	}
	_, _, err = Parse(context.Background(), stripped, key, publishers)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Fatalf("Parse(unsigned) error = %v, want ErrInvalidSignature", err)
	}
}

const testPublisherKeyID = "test-publisher"

func newTestSigner(t *testing.T) (Signer, KeyRing) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	return Signer{KeyID: testPublisherKeyID, Key: private}, KeyRing{testPublisherKeyID: public}
}

func newSignedTestPack(t *testing.T) ([]byte, []byte, KeyRing) {
	t.Helper()
	plain := newTestPackArchive(t)
	key := []byte("0123456789abcdef0123456789abcdef")
	signer, publishers := newTestSigner(t)
	raw, err := Build(context.Background(), plain, Manifest{
		ID:      "com.example.pro.test",
		Name:    "Pro Test Pack",
		Version: "1.0.0",
		KeyID:   "default",
	}, key, signer)
	if err != nil {
		t.Fatalf("Build() error = %v", err)
	}
	return raw, key, publishers
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

// tamperManifest mutates the stored manifest. When resign is non-nil the
// tampered manifest is re-signed with that signer; otherwise the original
// signature file is left untouched.
func tamperManifest(raw []byte, resign *Signer, mutate func(*Manifest)) ([]byte, error) {
	var tamperedManifest []byte
	rewritten, err := rewriteArchive(raw, func(name string, content []byte) ([]byte, bool) {
		if name != manifestFile {
			return content, true
		}
		var manifest Manifest
		if err := json.Unmarshal(content, &manifest); err != nil {
			return nil, false
		}
		mutate(&manifest)
		updated, err := json.Marshal(manifest)
		if err != nil {
			return nil, false
		}
		tamperedManifest = updated
		return updated, true
	})
	if err != nil {
		return nil, err
	}
	if resign == nil {
		return rewritten, nil
	}
	signature, err := json.Marshal(Signature{
		Algorithm: signatureAlgorithm,
		KeyID:     resign.KeyID,
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(resign.Key, tamperedManifest)),
	})
	if err != nil {
		return nil, err
	}
	return rewriteArchive(rewritten, func(name string, content []byte) ([]byte, bool) {
		if name == signatureFile {
			return signature, true
		}
		return content, true
	})
}

// rewriteArchive rebuilds a zip, letting transform replace file contents or
// drop entries (return keep=false).
func rewriteArchive(raw []byte, transform func(name string, content []byte) ([]byte, bool)) ([]byte, error) {
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
		updated, keep := transform(file.Name, content)
		if !keep {
			continue
		}
		outFile, err := writer.Create(file.Name)
		if err != nil {
			return nil, err
		}
		if _, err := outFile.Write(updated); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
