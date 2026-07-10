package license

import "errors"

var (
	// ErrLicenseConfigInvalid indicates the developer license config is invalid.
	ErrLicenseConfigInvalid = errors.New("invalid license configuration")
	// ErrLicenseNotAuthorized indicates the current context is not authorized for the request.
	ErrLicenseNotAuthorized = errors.New("license entitlement is missing")
	// ErrPackKeyNotFound indicates no matching pack decryption key is available.
	ErrPackKeyNotFound = errors.New("license pack key not found")
)
