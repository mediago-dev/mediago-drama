// Package codec provides reversible light obfuscation for .mgpack files.
package codec

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math/bits"
)

var (
	// ErrInvalidFormat reports malformed .mgpack bytes.
	ErrInvalidFormat = errors.New("invalid mgpack format")
	// ErrUnsupportedVersion reports a .mgpack version this codec cannot read.
	ErrUnsupportedVersion = errors.New("unsupported mgpack version")
)

const (
	version  byte = 1
	magic         = "MGPK"
	alphabet      = "ZYXABCDEFGHIJKLMNOPQRSTUVWzyxabcdefghijklmnopqrstuvw0123456789+/"
)

var encoding = base64.NewEncoding(alphabet)

// Encode transforms zip bytes into an obfuscated .mgpack payload.
func Encode(data []byte) []byte {
	transformed := transform(data)
	text := encoding.EncodeToString(transformed)
	output := make([]byte, 0, len(magic)+1+len(text))
	output = append(output, magic...)
	output = append(output, version)
	output = append(output, text...)
	return output
}

// Decode restores zip bytes from an obfuscated .mgpack payload.
func Decode(data []byte) ([]byte, error) {
	if len(data) < len(magic)+1 || string(data[:len(magic)]) != magic {
		return nil, fmt.Errorf("%w: missing MGPK header", ErrInvalidFormat)
	}
	if data[len(magic)] != version {
		return nil, fmt.Errorf("%w: %d", ErrUnsupportedVersion, data[len(magic)])
	}
	decoded, err := encoding.DecodeString(string(data[len(magic)+1:]))
	if err != nil {
		return nil, fmt.Errorf("%w: decoding payload: %w", ErrInvalidFormat, err)
	}
	return inverseTransform(decoded), nil
}

func transform(data []byte) []byte {
	output := make([]byte, len(data))
	for index, value := range data {
		mask := byte(0x5a + (index*31)%97)
		shift := int(index%7) + 1
		output[index] = bits.RotateLeft8(value^mask, shift)
	}
	return output
}

func inverseTransform(data []byte) []byte {
	output := make([]byte, len(data))
	for index, value := range data {
		mask := byte(0x5a + (index*31)%97)
		shift := int(index%7) + 1
		output[index] = bits.RotateLeft8(value, -shift) ^ mask
	}
	return output
}
