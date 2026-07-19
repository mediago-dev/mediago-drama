// Package protectedpack adapts the optional private prompt-pack importer to
// the open-source prompt-pack service.
package protectedpack

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

const (
	protocolFormat         = "mediago-protected-pack-import"
	protocolVersion        = 1
	maxProtocolHeaderBytes = 64 << 10
	maxDiagnosticBytes     = 4 << 10

	exitAccessDenied         = 20
	exitAuthorizationExpired = 21
	exitAuthorizationFailed  = 22
	exitRuntimeUnavailable   = 23
	exitInvalidProtectedPack = 24
)

type protocolHeader struct {
	Format         string `json:"format"`
	Version        int    `json:"version"`
	PackageID      string `json:"packageId"`
	ReleaseID      string `json:"releaseId"`
	PackageVersion string `json:"packageVersion"`
	PayloadLength  int    `json:"payloadLength"`
	PayloadSHA256  string `json:"payloadSha256"`
}

// Importer invokes a private helper process without exposing its authorization
// or cryptographic implementation to this package.
type Importer struct {
	executable string
}

// New returns a protected-pack process adapter for executable.
func New(executable string) (*Importer, error) {
	executable = strings.TrimSpace(executable)
	if executable == "" {
		return nil, fmt.Errorf("protected prompt pack importer path is required")
	}
	absPath, err := filepath.Abs(executable)
	if err != nil {
		return nil, fmt.Errorf("resolving protected prompt pack importer: %w", err)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, fmt.Errorf("stat protected prompt pack importer: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("protected prompt pack importer is not a regular file")
	}
	return &Importer{executable: absPath}, nil
}

// Import delegates one opaque protected pack to the private helper.
func (importer *Importer) Import(
	ctx context.Context,
	_ string,
	data []byte,
) (servicepromptpack.ProtectedImport, error) {
	if importer == nil || strings.TrimSpace(importer.executable) == "" {
		return servicepromptpack.ProtectedImport{}, servicepromptpack.ErrProtectedPackUnavailable
	}
	if ctx == nil {
		return servicepromptpack.ProtectedImport{}, fmt.Errorf("protected prompt pack context is required")
	}
	command := exec.CommandContext(ctx, importer.executable, "import")
	command.Stdin = bytes.NewReader(data)
	stdout := boundedBuffer{maxBytes: 4 + maxProtocolHeaderBytes + int(servicepromptpack.MaxUploadBytes())}
	stderr := cappedBuffer{maxBytes: maxDiagnosticBytes}
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return servicepromptpack.ProtectedImport{}, mapProcessError(ctx, err, stderr.String())
	}
	return parseFrame(stdout.Bytes())
}

type boundedBuffer struct {
	bytes.Buffer
	maxBytes int
}

func (buffer *boundedBuffer) Write(data []byte) (int, error) {
	remaining := buffer.maxBytes - buffer.Len()
	if remaining <= 0 {
		return 0, fmt.Errorf("protected prompt pack importer response is too large")
	}
	if len(data) > remaining {
		written, _ := buffer.Buffer.Write(data[:remaining])
		return written, fmt.Errorf("protected prompt pack importer response is too large")
	}
	return buffer.Buffer.Write(data)
}

type cappedBuffer struct {
	bytes.Buffer
	maxBytes int
}

func (buffer *cappedBuffer) Write(data []byte) (int, error) {
	total := len(data)
	remaining := buffer.maxBytes - buffer.Len()
	if remaining > 0 {
		if remaining > len(data) {
			remaining = len(data)
		}
		_, _ = buffer.Buffer.Write(data[:remaining])
	}
	return total, nil
}

func parseFrame(frame []byte) (servicepromptpack.ProtectedImport, error) {
	if len(frame) < 4 {
		return servicepromptpack.ProtectedImport{}, invalidProtocol("response prefix is missing")
	}
	headerLength := int(binary.BigEndian.Uint32(frame[:4]))
	if headerLength <= 0 || headerLength > maxProtocolHeaderBytes || len(frame) < 4+headerLength {
		return servicepromptpack.ProtectedImport{}, invalidProtocol("response header length is invalid")
	}
	var header protocolHeader
	if err := json.Unmarshal(frame[4:4+headerLength], &header); err != nil {
		return servicepromptpack.ProtectedImport{}, invalidProtocol("response header is invalid")
	}
	payload := frame[4+headerLength:]
	if header.Format != protocolFormat || header.Version != protocolVersion {
		return servicepromptpack.ProtectedImport{}, invalidProtocol("response protocol is unsupported")
	}
	if strings.TrimSpace(header.PackageID) == "" ||
		strings.TrimSpace(header.ReleaseID) == "" ||
		strings.TrimSpace(header.PackageVersion) == "" {
		return servicepromptpack.ProtectedImport{}, invalidProtocol("release identity is incomplete")
	}
	if header.PayloadLength != len(payload) || len(payload) == 0 || len(payload) > int(servicepromptpack.MaxUploadBytes()) {
		return servicepromptpack.ProtectedImport{}, invalidProtocol("payload length is invalid")
	}
	digest := sha256.Sum256(payload)
	if !strings.EqualFold(strings.TrimSpace(header.PayloadSHA256), hex.EncodeToString(digest[:])) {
		return servicepromptpack.ProtectedImport{}, invalidProtocol("payload digest does not match")
	}
	return servicepromptpack.ProtectedImport{
		PackageID: strings.TrimSpace(header.PackageID),
		ReleaseID: strings.TrimSpace(header.ReleaseID),
		Version:   strings.TrimSpace(header.PackageVersion),
		Payload:   append([]byte(nil), payload...),
	}, nil
}

func mapProcessError(ctx context.Context, err error, diagnostic string) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return fmt.Errorf("%w: %v", servicepromptpack.ErrProtectedPackUnavailable, err)
	}
	diagnostic = strings.TrimSpace(diagnostic)
	switch exitErr.ExitCode() {
	case exitAccessDenied, exitAuthorizationFailed:
		return withDiagnostic(servicepromptpack.ErrProtectedPackAccessDenied, diagnostic)
	case exitAuthorizationExpired:
		return withDiagnostic(servicepromptpack.ErrProtectedPackAuthorizationExpired, diagnostic)
	case exitRuntimeUnavailable:
		return withDiagnostic(servicepromptpack.ErrProtectedPackUnavailable, diagnostic)
	case exitInvalidProtectedPack:
		return withDiagnostic(servicepromptpack.ErrInvalidPack, diagnostic)
	default:
		return withDiagnostic(servicepromptpack.ErrProtectedPackUnavailable, diagnostic)
	}
}

func invalidProtocol(message string) error {
	return fmt.Errorf("%w: private importer %s", servicepromptpack.ErrProtectedPackUnavailable, message)
}

func withDiagnostic(base error, diagnostic string) error {
	if diagnostic == "" {
		return base
	}
	const maxDiagnosticBytes = 512
	if len(diagnostic) > maxDiagnosticBytes {
		diagnostic = diagnostic[:maxDiagnosticBytes]
	}
	return fmt.Errorf("%w: %s", base, diagnostic)
}
