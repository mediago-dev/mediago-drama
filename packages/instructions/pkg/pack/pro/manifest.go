package pro

// Manifest defines the .mgpackpro wrapper metadata.
type Manifest struct {
	Format              string      `json:"format"`
	FormatVersion       int         `json:"formatVersion"`
	ID                  string      `json:"id"`
	Name                string      `json:"name"`
	Version             string      `json:"version"`
	Author              string      `json:"author,omitempty"`
	Description         string      `json:"description,omitempty"`
	RequiredEntitlement string      `json:"requiredEntitlement"`
	KeyID               string      `json:"keyId"`
	Encryption          Encryption  `json:"encryption"`
	Payload             PayloadMeta `json:"payload"`
}

// Encryption describes how the prompt pack payload is protected.
type Encryption struct {
	Algorithm string `json:"algorithm"`
	Nonce     string `json:"nonce"`
}

// PayloadMeta carries validation info for decryption.
type PayloadMeta struct {
	Digest string `json:"digest"`
	Size   int64  `json:"size"`
}

const (
	// FormatName is the expected wrapper format string.
	FormatName = "mediago.pro-pack"
	// FormatVersion is the current package version.
	FormatVersion = 1

	manifestFile = "manifest.json"
	payloadFile  = "payload.enc"

	defaultEncryptionAlgorithm = "AES-256-GCM"
)
