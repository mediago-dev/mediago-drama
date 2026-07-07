package pro

import "errors"

var (
	// ErrInvalidProPack reports invalid .mgpackpro payload or wrapper.
	ErrInvalidProPack = errors.New("invalid pro prompt pack")
	// ErrUnsupportedVersion reports an unsupported .mgpackpro format version.
	ErrUnsupportedVersion = errors.New("unsupported pro prompt pack version")
	// ErrDigestMismatch reports checksum verification failure.
	ErrDigestMismatch = errors.New("pro prompt pack digest mismatch")
	// ErrMissingKey reports that a decryption key is missing.
	ErrMissingKey = errors.New("pro pack decryption key is missing")
)
