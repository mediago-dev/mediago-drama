package protectedpack

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

func TestParseFrame(t *testing.T) {
	payload := []byte("v1 prompt pack")
	digest := sha256.Sum256(payload)
	header, err := json.Marshal(protocolHeader{
		Format:         protocolFormat,
		Version:        protocolVersion,
		PackageID:      "pack.example",
		ReleaseID:      "release-1",
		PackageVersion: "1.2.3",
		PayloadLength:  len(payload),
		PayloadSHA256:  hex.EncodeToString(digest[:]),
	})
	if err != nil {
		t.Fatal(err)
	}
	frame := make([]byte, 4, 4+len(header)+len(payload))
	binary.BigEndian.PutUint32(frame, uint32(len(header)))
	frame = append(frame, header...)
	frame = append(frame, payload...)

	result, err := parseFrame(frame)
	if err != nil {
		t.Fatalf("parseFrame() error = %v", err)
	}
	if result.PackageID != "pack.example" || result.ReleaseID != "release-1" || result.Version != "1.2.3" {
		t.Fatalf("parseFrame() identity = %#v", result)
	}
	if string(result.Payload) != string(payload) {
		t.Fatalf("parseFrame() payload = %q", result.Payload)
	}
}

func TestNewAcceptsExecutableRegularFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mediago-rights")
	if err := os.WriteFile(path, []byte("private runtime"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := New(path); err != nil {
		t.Fatalf("New(regular file) error = %v", err)
	}
}

func TestNewRejectsMissingOrNonRegularExecutable(t *testing.T) {
	if _, err := New(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("New(missing file) error = nil")
	}
	if _, err := New(t.TempDir()); err == nil {
		t.Fatal("New(directory) error = nil")
	}
}

func TestParseFrameRejectsDigestMismatch(t *testing.T) {
	header, err := json.Marshal(protocolHeader{
		Format:         protocolFormat,
		Version:        protocolVersion,
		PackageID:      "pack.example",
		ReleaseID:      "release-1",
		PackageVersion: "1.0.0",
		PayloadLength:  1,
		PayloadSHA256:  "00",
	})
	if err != nil {
		t.Fatal(err)
	}
	frame := make([]byte, 4, 4+len(header)+1)
	binary.BigEndian.PutUint32(frame, uint32(len(header)))
	frame = append(frame, header...)
	frame = append(frame, 'x')

	_, err = parseFrame(frame)
	if !errors.Is(err, servicepromptpack.ErrProtectedPackUnavailable) {
		t.Fatalf("parseFrame() error = %v, want ErrProtectedPackUnavailable", err)
	}
}

func TestBoundedBufferRejectsOversizedOutput(t *testing.T) {
	buffer := boundedBuffer{maxBytes: 4}
	if written, err := buffer.Write([]byte("12345")); err == nil || written != 4 {
		t.Fatalf("Write() = (%d, %v), want (4, error)", written, err)
	}
	if got := buffer.String(); got != "1234" {
		t.Fatalf("buffer = %q, want 1234", got)
	}
}

func TestCappedBufferDiscardsExcessDiagnostic(t *testing.T) {
	buffer := cappedBuffer{maxBytes: 4}
	if written, err := buffer.Write([]byte("12345")); err != nil || written != 5 {
		t.Fatalf("Write() = (%d, %v), want (5, nil)", written, err)
	}
	if got := buffer.String(); got != "1234" {
		t.Fatalf("buffer = %q, want 1234", got)
	}
}
