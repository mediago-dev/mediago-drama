package shared

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// RandomID returns a random identifier with the provided prefix.
func RandomID(prefix string) (string, error) {
	var data [8]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", err
	}
	return prefix + "-" + hex.EncodeToString(data[:]), nil
}

// MustRandomID returns a random identifier or a time-based fallback.
func MustRandomID(prefix string) string {
	id, err := RandomID(prefix)
	if err != nil {
		return prefix + "-" + fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return id
}
