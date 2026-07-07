package license

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

const (
	defaultProEntitlement = "pack.import.pro"

	licenseEntitlementsEnv = "MEDIAGO_LICENSE_ENTITLEMENTS"
	licensePackKeysEnv     = "MEDIAGO_LICENSE_PACK_KEYS"
)

var _ Service = (*DevProvider)(nil)

// DevProvider reads entitlement and decryption key config from environment.
//
// Format example:
// - MEDIAGO_LICENSE_ENTITLEMENTS=pack.import.pro,pack.premium.use
// - MEDIAGO_LICENSE_PACK_KEYS=default=aGVsbG8=,pack-premium-z=MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=
type DevProvider struct {
	entitlements map[string]struct{}
	keys         map[string][]byte
}

// NewDevProvider builds a provider from environment variables.
func NewDevProvider() *DevProvider {
	return NewDevProviderFromLookup(os.Getenv)
}

// NewDevProviderFromLookup builds a provider from custom env lookup.
func NewDevProviderFromLookup(lookup func(string) string) *DevProvider {
	if lookup == nil {
		lookup = func(string) string { return "" }
	}
	return &DevProvider{
		entitlements: parseEntitlements(lookup(licenseEntitlementsEnv)),
		keys:         parsePackKeys(lookup(licensePackKeysEnv)),
	}
}

// HasEntitlement reports whether entitlement is provisioned for current environment.
func (provider *DevProvider) HasEntitlement(_ context.Context, entitlement string) (bool, error) {
	if provider == nil {
		return false, ErrLicenseConfigInvalid
	}
	entitlement = strings.TrimSpace(entitlement)
	if entitlement == "" {
		entitlement = defaultProEntitlement
	}
	if _, ok := provider.entitlements[entitlement]; ok {
		return true, nil
	}
	_, wildcard := provider.entitlements["*"]
	return wildcard, nil
}

// ResolvePackKey returns the raw 32-byte AES key for the key identifier.
func (provider *DevProvider) ResolvePackKey(_ context.Context, keyID string) ([]byte, error) {
	if provider == nil {
		return nil, ErrLicenseConfigInvalid
	}
	keyID = strings.TrimSpace(keyID)
	if keyID == "" {
		keyID = "default"
	}
	key, ok := provider.keys[keyID]
	if ok {
		result := make([]byte, len(key))
		copy(result, key)
		return result, nil
	}
	return nil, fmt.Errorf("%w: %q", ErrPackKeyNotFound, keyID)
}

// HasEntitlements returns entitlement keys for tests.
func (provider *DevProvider) HasEntitlements() map[string]struct{} {
	if provider == nil {
		return map[string]struct{}{}
	}
	copy := make(map[string]struct{}, len(provider.entitlements))
	for key := range provider.entitlements {
		copy[key] = struct{}{}
	}
	return copy
}

func parseEntitlements(raw string) map[string]struct{} {
	entitlements := make(map[string]struct{})
	for _, item := range strings.Split(raw, ",") {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		entitlements[value] = struct{}{}
	}
	return entitlements
}

func parsePackKeys(raw string) map[string][]byte {
	keys := make(map[string][]byte)
	for _, item := range strings.Split(raw, ",") {
		part := strings.TrimSpace(item)
		if part == "" {
			continue
		}
		pieces := strings.SplitN(part, "=", 2)
		if len(pieces) != 2 {
			continue
		}
		keyID := strings.TrimSpace(pieces[0])
		encoded := strings.TrimSpace(pieces[1])
		if keyID == "" || encoded == "" {
			continue
		}
		value, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(value) != 32 {
			continue
		}
		keys[keyID] = value
	}
	return keys
}

// DefaultProEntitlement returns the entitlement used when a manifest omits it.
func DefaultProEntitlement() string {
	return defaultProEntitlement
}
