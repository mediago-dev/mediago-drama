package codec

import (
	"bytes"
	"errors"
	"testing"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	input := []byte("zip bytes go here")
	encoded := Encode(input)
	if bytes.Contains(encoded, input) {
		t.Fatalf("Encode() output should not contain plaintext")
	}
	decoded, err := Decode(encoded)
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if !bytes.Equal(decoded, input) {
		t.Fatalf("Decode(Encode(input)) = %q, want %q", decoded, input)
	}
}

func TestDecodeRejectsBadMagic(t *testing.T) {
	_, err := Decode([]byte("zip"))
	if !errors.Is(err, ErrInvalidFormat) {
		t.Fatalf("Decode() error = %v, want ErrInvalidFormat", err)
	}
}

func TestDecodeRejectsBadVersion(t *testing.T) {
	data := Encode([]byte("zip"))
	data[len(magic)] = 99
	_, err := Decode(data)
	if !errors.Is(err, ErrUnsupportedVersion) {
		t.Fatalf("Decode() error = %v, want ErrUnsupportedVersion", err)
	}
}
