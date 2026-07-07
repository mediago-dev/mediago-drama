package pro

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
)

const aesNonceSize = 12

// Signer identifies the publisher signing key used to author .mgpackpro archives.
type Signer struct {
	KeyID string
	Key   ed25519.PrivateKey
}

// KeyRing maps publisher key identifiers to trusted Ed25519 public keys.
type KeyRing map[string]ed25519.PublicKey

// Inspect reads and validates manifest metadata from a .mgpackpro archive,
// verifying the publisher signature against the trusted key ring.
func Inspect(ctx context.Context, data []byte, publishers KeyRing) (Manifest, error) {
	if err := ctxErr(ctx); err != nil {
		return Manifest{}, err
	}
	if len(data) == 0 {
		return Manifest{}, fmt.Errorf("%w: empty pro pack", ErrInvalidProPack)
	}
	reader, err := newZipReader(data)
	if err != nil {
		return Manifest{}, err
	}
	rawManifest, manifest, err := readManifest(reader)
	if err != nil {
		return Manifest{}, err
	}
	if err := validateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	if err := verifyPublisherSignature(reader, rawManifest, publishers); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

// Parse verifies, decrypts, and parses a .mgpackpro package into a pack bundle.
func Parse(ctx context.Context, data []byte, key []byte, publishers KeyRing) (Manifest, pack.Bundle, error) {
	manifest, bundle, err := parseBundle(ctx, data, key, publishers)
	if err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	return manifest, bundle, nil
}

// Build creates an encrypted, publisher-signed .mgpackpro archive from a plain pack zip payload.
func Build(ctx context.Context, bundleData []byte, manifest Manifest, key []byte, signer Signer) ([]byte, error) {
	if err := ctxErr(ctx); err != nil {
		return nil, err
	}
	bundleData = append([]byte(nil), bundleData...)
	if err := validateBuildManifest(manifest); err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("%w: key must be 32 bytes", ErrInvalidProPack)
	}
	signer.KeyID = strings.TrimSpace(signer.KeyID)
	if signer.KeyID == "" {
		return nil, fmt.Errorf("%w: signer key id is required", ErrInvalidProPack)
	}
	if len(signer.Key) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("%w: signer key must be %d bytes", ErrInvalidProPack, ed25519.PrivateKeySize)
	}
	if strings.TrimSpace(manifest.Format) == "" {
		manifest.Format = FormatName
	}
	if manifest.FormatVersion == 0 {
		manifest.FormatVersion = FormatVersion
	}
	if strings.TrimSpace(manifest.Encryption.Algorithm) == "" {
		manifest.Encryption.Algorithm = defaultEncryptionAlgorithm
	}
	if strings.TrimSpace(manifest.KeyID) == "" {
		manifest.KeyID = "default"
	}
	hash := sha256.Sum256(bundleData)
	manifest.Payload.Digest = "sha256:" + hex.EncodeToString(hash[:])
	manifest.Payload.Size = int64(len(bundleData))

	// Nonce is always freshly generated: accepting a caller-supplied nonce
	// invites catastrophic AES-GCM nonce reuse across builds with one key.
	nonce := make([]byte, aesNonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("%w: generating nonce: %s", ErrInvalidProPack, err)
	}
	manifest.Encryption.Nonce = base64.StdEncoding.EncodeToString(nonce)

	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		return nil, fmt.Errorf("%w: encoding manifest", ErrInvalidProPack)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("%w: creating cipher: %s", ErrInvalidProPack, err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("%w: creating gcm: %s", ErrInvalidProPack, err)
	}
	encrypted := aead.Seal(nil, nonce, bundleData, rawManifest)

	signature := Signature{
		Algorithm: signatureAlgorithm,
		KeyID:     signer.KeyID,
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(signer.Key, rawManifest)),
	}

	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	if err := writeZipRaw(writer, manifestFile, rawManifest); err != nil {
		_ = writer.Close()
		return nil, err
	}
	if err := writeZipRaw(writer, payloadFile, encrypted); err != nil {
		_ = writer.Close()
		return nil, err
	}
	if err := writeZipJSON(writer, signatureFile, signature); err != nil {
		_ = writer.Close()
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("%w: writing pack archive: %s", ErrInvalidProPack, err)
	}
	return output.Bytes(), nil
}

func parseBundle(ctx context.Context, data []byte, key []byte, publishers KeyRing) (Manifest, pack.Bundle, error) {
	if err := ctxErr(ctx); err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	if len(data) == 0 {
		return Manifest{}, pack.Bundle{}, fmt.Errorf("%w: empty pro pack", ErrInvalidProPack)
	}
	reader, err := newZipReader(data)
	if err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	rawManifest, manifest, err := readManifest(reader)
	if err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	if err := validateManifest(manifest); err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	if err := verifyPublisherSignature(reader, rawManifest, publishers); err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	if len(key) != 32 {
		return Manifest{}, pack.Bundle{}, fmt.Errorf("%w: 32-byte key required", ErrMissingKey)
	}
	nonce, err := decodeNonce(manifest.Encryption.Nonce)
	if err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	encrypted, err := readFile(reader, payloadFile)
	if err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return Manifest{}, pack.Bundle{}, fmt.Errorf("%w: creating cipher: %s", ErrInvalidProPack, err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return Manifest{}, pack.Bundle{}, fmt.Errorf("%w: creating gcm: %s", ErrInvalidProPack, err)
	}
	decrypted, err := aead.Open(nil, nonce, encrypted, rawManifest)
	if err != nil {
		return Manifest{}, pack.Bundle{}, fmt.Errorf("%w: decrypt payload", ErrInvalidProPack)
	}
	if err := verifyPayloadDigest(manifest.Payload, decrypted); err != nil {
		return Manifest{}, pack.Bundle{}, err
	}
	bundle, err := pack.ParseZip(ctx, decrypted)
	if err != nil {
		return Manifest{}, pack.Bundle{}, fmt.Errorf("%w: parsing bundle: %s", ErrInvalidProPack, err)
	}
	return manifest, bundle, nil
}

// verifyPublisherSignature checks the detached Ed25519 signature over the raw
// manifest bytes against the trusted publisher key ring.
func verifyPublisherSignature(reader *zip.Reader, rawManifest []byte, publishers KeyRing) error {
	raw, err := readFile(reader, signatureFile)
	if err != nil {
		return fmt.Errorf("%w: publisher signature is missing", ErrInvalidSignature)
	}
	var signature Signature
	if err := json.Unmarshal(raw, &signature); err != nil {
		return fmt.Errorf("%w: decoding signature", ErrInvalidSignature)
	}
	if !strings.EqualFold(strings.TrimSpace(signature.Algorithm), signatureAlgorithm) {
		return fmt.Errorf("%w: unsupported signature algorithm %q", ErrInvalidSignature, signature.Algorithm)
	}
	keyID := strings.TrimSpace(signature.KeyID)
	if keyID == "" {
		return fmt.Errorf("%w: signature key id is required", ErrInvalidSignature)
	}
	if len(publishers) == 0 {
		return fmt.Errorf("%w: no trusted publisher keys", ErrMissingPublisherKey)
	}
	publicKey, ok := publishers[keyID]
	if !ok {
		return fmt.Errorf("%w: %q", ErrMissingPublisherKey, keyID)
	}
	if len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("%w: publisher key %q must be %d bytes", ErrMissingPublisherKey, keyID, ed25519.PublicKeySize)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signature.Signature))
	if err != nil || len(decoded) != ed25519.SignatureSize {
		return fmt.Errorf("%w: malformed signature", ErrInvalidSignature)
	}
	if !ed25519.Verify(publicKey, rawManifest, decoded) {
		return fmt.Errorf("%w: signature verification failed", ErrInvalidSignature)
	}
	return nil
}

func validateManifest(manifest Manifest) error {
	if strings.TrimSpace(manifest.Format) != FormatName {
		return fmt.Errorf("%w: unsupported format %q", ErrInvalidProPack, manifest.Format)
	}
	if manifest.FormatVersion != FormatVersion {
		return fmt.Errorf("%w: expected version %d", ErrUnsupportedVersion, FormatVersion)
	}
	if strings.TrimSpace(manifest.ID) == "" || strings.TrimSpace(manifest.Name) == "" || strings.TrimSpace(manifest.Version) == "" {
		return fmt.Errorf("%w: missing pack identity", ErrInvalidProPack)
	}
	if strings.TrimSpace(manifest.Encryption.Algorithm) != defaultEncryptionAlgorithm {
		return fmt.Errorf("%w: unsupported algorithm", ErrInvalidProPack)
	}
	if strings.TrimSpace(manifest.Encryption.Nonce) == "" {
		return fmt.Errorf("%w: encryption nonce is required", ErrInvalidProPack)
	}
	if strings.TrimSpace(manifest.Payload.Digest) == "" {
		return fmt.Errorf("%w: payload digest is required", ErrInvalidProPack)
	}
	if manifest.Payload.Size <= 0 {
		return fmt.Errorf("%w: payload size must be positive", ErrInvalidProPack)
	}
	return nil
}

func validateBuildManifest(manifest Manifest) error {
	if strings.TrimSpace(manifest.Encryption.Algorithm) != "" && strings.TrimSpace(manifest.Encryption.Algorithm) != defaultEncryptionAlgorithm {
		return fmt.Errorf("%w: unsupported algorithm", ErrInvalidProPack)
	}
	if strings.TrimSpace(manifest.Format) != "" && strings.TrimSpace(manifest.Format) != FormatName {
		return fmt.Errorf("%w: unsupported format %q", ErrInvalidProPack, manifest.Format)
	}
	if strings.TrimSpace(manifest.ID) == "" || strings.TrimSpace(manifest.Name) == "" || strings.TrimSpace(manifest.Version) == "" {
		return fmt.Errorf("%w: missing pack identity", ErrInvalidProPack)
	}
	if strings.TrimSpace(manifest.KeyID) == "" {
		return fmt.Errorf("%w: key id is required", ErrInvalidProPack)
	}
	return nil
}

func decodeNonce(raw string) ([]byte, error) {
	nonce, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("%w: decoding nonce", ErrInvalidProPack)
	}
	if len(nonce) != aesNonceSize {
		return nil, fmt.Errorf("%w: expected %d-byte nonce", ErrInvalidProPack, aesNonceSize)
	}
	return nonce, nil
}

func verifyPayloadDigest(meta PayloadMeta, payload []byte) error {
	if meta.Size > 0 && int64(len(payload)) != meta.Size {
		return fmt.Errorf("%w: invalid payload size", ErrDigestMismatch)
	}
	if meta.Size <= 0 {
		return fmt.Errorf("%w: payload size must be positive", ErrInvalidProPack)
	}
	if strings.TrimSpace(meta.Digest) == "" {
		return fmt.Errorf("%w: payload digest is required", ErrInvalidProPack)
	}
	parts := strings.SplitN(meta.Digest, ":", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "sha256" {
		return fmt.Errorf("%w: unsupported digest format", ErrInvalidProPack)
	}
	actual := sha256.Sum256(payload)
	expected, err := hex.DecodeString(parts[1])
	if err != nil {
		return fmt.Errorf("%w: invalid digest", ErrInvalidProPack)
	}
	if len(expected) != len(actual) {
		return fmt.Errorf("%w: invalid digest length", ErrDigestMismatch)
	}
	if subtle.ConstantTimeCompare(expected, actual[:]) != 1 {
		return ErrDigestMismatch
	}
	return nil
}

func newZipReader(data []byte) (*zip.Reader, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("%w: opening pro pack archive", ErrInvalidProPack)
	}
	return reader, nil
}

// readManifest returns both the raw manifest bytes (the exact signed and
// authenticated representation) and the decoded manifest.
func readManifest(reader *zip.Reader) ([]byte, Manifest, error) {
	raw, err := readFile(reader, manifestFile)
	if err != nil {
		return nil, Manifest{}, err
	}
	var manifest Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, Manifest{}, fmt.Errorf("%w: decoding manifest", ErrInvalidProPack)
	}
	return raw, manifest, nil
}

func readFile(reader *zip.Reader, name string) ([]byte, error) {
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		source, err := file.Open()
		if err != nil {
			return nil, fmt.Errorf("%w: opening %q", ErrInvalidProPack, name)
		}
		defer source.Close()
		data, err := io.ReadAll(source)
		if err != nil {
			return nil, fmt.Errorf("%w: reading %q", ErrInvalidProPack, name)
		}
		return data, nil
	}
	return nil, fmt.Errorf("%w: %q is missing", ErrInvalidProPack, name)
}

func writeZipJSON(writer *zip.Writer, path string, value any) error {
	var raw bytes.Buffer
	if err := json.NewEncoder(&raw).Encode(value); err != nil {
		return fmt.Errorf("%w: encoding %q", ErrInvalidProPack, path)
	}
	return writeZipRaw(writer, path, raw.Bytes())
}

func writeZipRaw(writer *zip.Writer, path string, content []byte) error {
	file, err := writer.Create(path)
	if err != nil {
		return fmt.Errorf("%w: creating %q", ErrInvalidProPack, path)
	}
	if _, err := file.Write(content); err != nil {
		return fmt.Errorf("%w: writing %q", ErrInvalidProPack, path)
	}
	return nil
}

func ctxErr(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	return ctx.Err()
}
