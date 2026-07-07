package license

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"
)

func TestDevProviderHasEntitlement(t *testing.T) {
	tests := []struct {
		name        string
		env         map[string]string
		entitlement string
		want        bool
	}{
		{
			name:        "granted entitlement",
			env:         map[string]string{licenseEntitlementsEnv: "pack.import.pro,pack.premium.use"},
			entitlement: "pack.import.pro",
			want:        true,
		},
		{
			name:        "missing entitlement",
			env:         map[string]string{licenseEntitlementsEnv: "pack.premium.use"},
			entitlement: "pack.import.pro",
			want:        false,
		},
		{
			name:        "empty entitlement falls back to default",
			env:         map[string]string{licenseEntitlementsEnv: defaultProEntitlement},
			entitlement: "  ",
			want:        true,
		},
		{
			name:        "wildcard grants everything",
			env:         map[string]string{licenseEntitlementsEnv: "*"},
			entitlement: "pack.anything.else",
			want:        true,
		},
		{
			name:        "empty config grants nothing",
			env:         map[string]string{},
			entitlement: "pack.import.pro",
			want:        false,
		},
		{
			name:        "whitespace entries are ignored",
			env:         map[string]string{licenseEntitlementsEnv: " , pack.import.pro , "},
			entitlement: "pack.import.pro",
			want:        true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := NewDevProviderFromLookup(func(key string) string { return tt.env[key] })
			got, err := provider.HasEntitlement(context.Background(), tt.entitlement)
			if err != nil {
				t.Fatalf("HasEntitlement() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("HasEntitlement(%q) = %v, want %v", tt.entitlement, got, tt.want)
			}
		})
	}
}

func TestDevProviderResolvePackKey(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString(make([]byte, packKeyLength))
	shortKey := base64.StdEncoding.EncodeToString(make([]byte, 16))
	tests := []struct {
		name    string
		env     string
		keyID   string
		wantErr error
		wantLen int
	}{
		{
			name:    "resolves configured key",
			env:     "default=" + validKey,
			keyID:   "default",
			wantLen: packKeyLength,
		},
		{
			name:    "empty key id falls back to default",
			env:     "default=" + validKey,
			keyID:   "  ",
			wantLen: packKeyLength,
		},
		{
			name:    "unknown key id",
			env:     "default=" + validKey,
			keyID:   "other",
			wantErr: ErrPackKeyNotFound,
		},
		{
			name:    "wrong key length is skipped",
			env:     "default=" + shortKey,
			keyID:   "default",
			wantErr: ErrPackKeyNotFound,
		},
		{
			name:    "invalid base64 is skipped",
			env:     "default=%%%not-base64%%%",
			keyID:   "default",
			wantErr: ErrPackKeyNotFound,
		},
		{
			name:    "malformed entries are skipped",
			env:     "no-separator,default=" + validKey,
			keyID:   "default",
			wantLen: packKeyLength,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := NewDevProviderFromLookup(func(key string) string {
				if key == licensePackKeysEnv {
					return tt.env
				}
				return ""
			})
			key, err := provider.ResolvePackKey(context.Background(), tt.keyID)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("ResolvePackKey() error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolvePackKey() error = %v", err)
			}
			if len(key) != tt.wantLen {
				t.Fatalf("key length = %d, want %d", len(key), tt.wantLen)
			}
		})
	}
}

func TestDevProviderResolvePublisherKeys(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString(make([]byte, publisherKeyLength))
	shortKey := base64.StdEncoding.EncodeToString(make([]byte, 8))
	provider := NewDevProviderFromLookup(func(key string) string {
		if key == licensePublisherKeysEnv {
			return "mediago-2026=" + validKey + ",broken=" + shortKey
		}
		return ""
	})
	keys, err := provider.ResolvePublisherKeys(context.Background())
	if err != nil {
		t.Fatalf("ResolvePublisherKeys() error = %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("keys = %v, want only the valid entry", keys)
	}
	if len(keys["mediago-2026"]) != publisherKeyLength {
		t.Fatalf("publisher key length = %d, want %d", len(keys["mediago-2026"]), publisherKeyLength)
	}

	// Returned map must be a copy, not internal state.
	keys["mediago-2026"][0] ^= 0xff
	again, err := provider.ResolvePublisherKeys(context.Background())
	if err != nil {
		t.Fatalf("ResolvePublisherKeys() second call error = %v", err)
	}
	if again["mediago-2026"][0] != 0 {
		t.Fatal("ResolvePublisherKeys() must return a defensive copy")
	}
}
