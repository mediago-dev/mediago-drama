package license

import "context"

// Service validates prompt-pack entitlements and resolves decryption keys.
//
// Entitlement identifiers are defined by the license feature contract in
// contracts/license/v1/features.yaml — implementations must treat unknown
// entitlements as not granted.
type Service interface {
	HasEntitlement(ctx context.Context, entitlement string) (bool, error)
	ResolvePackKey(ctx context.Context, keyID string) ([]byte, error)
	// ResolvePublisherKeys returns the trusted pack publisher Ed25519 public
	// keys (32 bytes each) keyed by publisher key id.
	ResolvePublisherKeys(ctx context.Context) (map[string][]byte, error)
}
