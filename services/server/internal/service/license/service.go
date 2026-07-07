package license

import "context"

// Service validates prompt-pack entitlements and resolves decryption keys.
type Service interface {
	HasEntitlement(ctx context.Context, entitlement string) (bool, error)
	ResolvePackKey(ctx context.Context, keyID string) ([]byte, error)
}
