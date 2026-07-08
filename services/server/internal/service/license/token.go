package license

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	// ErrTokenInvalid indicates a malformed or wrongly signed license token.
	ErrTokenInvalid = errors.New("license token is invalid")
	// ErrTokenExpired indicates the license token expired.
	ErrTokenExpired = errors.New("license token is expired")
)

// TokenPayload mirrors contracts/license/v1/token.schema.json. The token wire
// format is base64url(payloadJSON) + "." + base64url(ed25519 signature).
type TokenPayload struct {
	LicenseID         string    `json:"license_id"`
	Plan              string    `json:"plan"`
	Entitlements      []string  `json:"entitlements"`
	ExpiresAt         time.Time `json:"expires_at"`
	DeviceHash        string    `json:"device_hash,omitempty"`
	LicenseAPIVersion string    `json:"license_api_version"`
}

// HasEntitlement reports whether the payload grants the entitlement.
func (payload TokenPayload) HasEntitlement(entitlement string) bool {
	entitlement = strings.TrimSpace(entitlement)
	for _, granted := range payload.Entitlements {
		if strings.TrimSpace(granted) == entitlement {
			return true
		}
	}
	return false
}

// VerifyToken checks the token signature against the base64 Ed25519 public
// key and enforces expiry. On expiry the payload is still returned so callers
// can render status details.
func VerifyToken(token string, publicKeyBase64 string) (TokenPayload, error) {
	publicKey, err := base64.StdEncoding.DecodeString(strings.TrimSpace(publicKeyBase64))
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return TokenPayload{}, fmt.Errorf("%w: bad public key", ErrTokenInvalid)
	}
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 2 {
		return TokenPayload{}, ErrTokenInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TokenPayload{}, ErrTokenInvalid
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(signature) != ed25519.SignatureSize {
		return TokenPayload{}, ErrTokenInvalid
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), raw, signature) {
		return TokenPayload{}, ErrTokenInvalid
	}
	var payload TokenPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return TokenPayload{}, ErrTokenInvalid
	}
	if payload.LicenseAPIVersion != "v1" {
		return TokenPayload{}, fmt.Errorf("%w: unsupported api version", ErrTokenInvalid)
	}
	if time.Now().After(payload.ExpiresAt) {
		return payload, ErrTokenExpired
	}
	return payload, nil
}
