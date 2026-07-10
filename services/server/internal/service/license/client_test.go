package license

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientActivateAndResolveFlow(t *testing.T) {
	ctx := context.Background()
	fake := newFakeLicenseServer(t)
	defer fake.Close()

	client := NewClient(fake.URL(), t.TempDir())
	if !client.Configured() {
		t.Fatal("Configured() = false, want true")
	}
	if status := client.Status(); len(status.Entitlements) > 0 {
		t.Fatalf("Status() = %#v, want no active grants", status)
	}

	status, err := client.Activate(ctx, "MG-GOOD-CODE")
	if err != nil {
		t.Fatalf("Activate() error = %v", err)
	}
	if len(status.Activations) != 1 || status.Activations[0].Plan != "pro" {
		t.Fatalf("status = %#v, want one pro activation", status)
	}

	granted, err := client.HasEntitlement(ctx, "pack.import.pro")
	if err != nil || !granted {
		t.Fatalf("HasEntitlement() = %v, %v; want true, nil", granted, err)
	}
	denied, err := client.HasEntitlement(ctx, "pack.other")
	if err != nil || denied {
		t.Fatalf("HasEntitlement(other) = %v, %v; want false, nil", denied, err)
	}

	key, err := client.ResolvePackKey(ctx, "default", "pack.import.pro")
	if err != nil {
		t.Fatalf("ResolvePackKey() error = %v", err)
	}
	if len(key) != 32 {
		t.Fatalf("key length = %d, want 32", len(key))
	}

	publishers, err := client.ResolvePublisherKeys(ctx)
	if err != nil {
		t.Fatalf("ResolvePublisherKeys() error = %v", err)
	}
	if len(publishers["mediago-test"]) != 32 {
		t.Fatalf("publishers = %v, want mediago-test 32B", publishers)
	}

	status, err = client.Deactivate("")
	if err != nil {
		t.Fatalf("Deactivate() error = %v", err)
	}
	if len(status.Entitlements) > 0 {
		t.Fatalf("status after deactivate = %#v, want no active grants", status)
	}
	if _, err := client.ResolvePackKey(ctx, "default", "pack.import.pro"); !errors.Is(err, ErrPackKeyNotFound) {
		t.Fatalf("ResolvePackKey() after deactivate error = %v, want ErrPackKeyNotFound", err)
	}
}

func TestClientActivateRejectedCode(t *testing.T) {
	fake := newFakeLicenseServer(t)
	defer fake.Close()
	client := NewClient(fake.URL(), t.TempDir())
	_, err := client.Activate(context.Background(), "MG-BAD-CODE")
	if !errors.Is(err, ErrActivationRejected) {
		t.Fatalf("Activate() error = %v, want ErrActivationRejected", err)
	}
}

func TestClientRejectsExpiredStoredToken(t *testing.T) {
	fake := newFakeLicenseServer(t)
	defer fake.Close()
	stateDir := t.TempDir()
	client := NewClient(fake.URL(), stateDir)

	token := fake.issueToken(t, "", time.Now().Add(-time.Hour))
	if err := client.saveStore([]storedLicense{{
		Token:           token,
		ServerURL:       fake.URL(),
		ServerPublicKey: fake.publicKeyBase64(),
		SavedAt:         time.Now().UTC().Format(time.RFC3339),
	}}); err != nil {
		t.Fatalf("saveStore() error = %v", err)
	}
	if status := client.Status(); len(status.Entitlements) > 0 {
		t.Fatalf("Status() = %#v, want expired => no active grants", status)
	}
	granted, err := client.HasEntitlement(context.Background(), "pack.import.pro")
	if err != nil || granted {
		t.Fatalf("HasEntitlement(expired) = %v, %v; want false, nil", granted, err)
	}
	if _, err := client.ResolvePackKey(context.Background(), "default", "pack.import.pro"); !errors.Is(err, ErrPackKeyNotFound) {
		t.Fatalf("ResolvePackKey(expired) error = %v, want ErrPackKeyNotFound", err)
	}
}

func TestClientRejectsTokenBoundToAnotherDevice(t *testing.T) {
	ctx := context.Background()
	fake := newFakeLicenseServer(t)
	defer fake.Close()
	client := NewClient(fake.URL(), t.TempDir())

	// A validly-signed token bound to a different device — i.e. a license
	// file copied from someone else's activated machine.
	token := fake.issueToken(nil, "some-other-device", time.Now().Add(time.Hour))
	if err := client.saveStore([]storedLicense{{
		Token:           token,
		ServerURL:       fake.URL(),
		ServerPublicKey: fake.publicKeyBase64(),
		SavedAt:         time.Now().UTC().Format(time.RFC3339),
	}}); err != nil {
		t.Fatalf("saveStore() error = %v", err)
	}

	if status := client.Status(); len(status.Entitlements) > 0 {
		t.Fatalf("Status() = %#v, want no active grants on a foreign device", status)
	}
	granted, err := client.HasEntitlement(ctx, "pack.import.pro")
	if err != nil || granted {
		t.Fatalf("HasEntitlement(foreign device) = %v, %v; want false, nil", granted, err)
	}
	if _, err := client.ResolvePackKey(ctx, "default", "pack.import.pro"); !errors.Is(err, ErrPackKeyNotFound) {
		t.Fatalf("ResolvePackKey(foreign device) error = %v, want ErrPackKeyNotFound", err)
	}
}

func TestClientActivateBindsToLocalDevice(t *testing.T) {
	ctx := context.Background()
	fake := newFakeLicenseServer(t)
	defer fake.Close()
	client := NewClient(fake.URL(), t.TempDir())

	// Activation binds the token to this device; the same client resolves fine.
	if _, err := client.Activate(ctx, "MG-GOOD-CODE"); err != nil {
		t.Fatalf("Activate() error = %v", err)
	}
	if status := client.Status(); len(status.Entitlements) == 0 {
		t.Fatalf("Status() = %#v, want active grants on the binding device", status)
	}
	if _, err := client.ResolvePackKey(ctx, "default", "pack.import.pro"); err != nil {
		t.Fatalf("ResolvePackKey(same device) error = %v", err)
	}
}

func TestClientActivateNotConfigured(t *testing.T) {
	client := NewClient("", t.TempDir())
	_, err := client.Activate(context.Background(), "MG-ANY")
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("Activate() error = %v, want ErrNotConfigured", err)
	}
}

func TestNewFromEnvironmentSelectsProvider(t *testing.T) {
	t.Setenv("MEDIAGO_LICENSE_SERVER_URL", "")
	service, client := NewFromEnvironment(t.TempDir())
	if _, ok := service.(*DevProvider); !ok {
		t.Fatalf("service = %T, want *DevProvider", service)
	}
	if client.Configured() {
		t.Fatal("client.Configured() = true, want false without env")
	}

	t.Setenv("MEDIAGO_LICENSE_SERVER_URL", "http://127.0.0.1:9")
	service, client = NewFromEnvironment(t.TempDir())
	if service != Service(client) {
		t.Fatalf("service = %T, want the remote client", service)
	}
}

// fakeLicenseServer emulates the private license server's envelope contract.
type fakeLicenseServer struct {
	server    *httptest.Server
	publicKey ed25519.PublicKey
	private   ed25519.PrivateKey
	packKey   []byte
}

func newFakeLicenseServer(t *testing.T) *fakeLicenseServer {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey() error = %v", err)
	}
	fake := &fakeLicenseServer{publicKey: public, private: private, packKey: make([]byte, 32)}
	if _, err := rand.Read(fake.packKey); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/license/public-key", func(w http.ResponseWriter, _ *http.Request) {
		writeEnvelope(w, http.StatusOK, map[string]any{"algorithm": "ed25519", "public_key": fake.publicKeyBase64()})
	})
	mux.HandleFunc("POST /api/v1/activate", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ActivationCode  string `json:"activation_code"`
			DevicePublicKey string `json:"device_public_key"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.ActivationCode != "MG-GOOD-CODE" {
			writeEnvelopeError(w, http.StatusForbidden, 40310, "activation code is invalid")
			return
		}
		// Bind the issued token to the activating device's public key.
		writeEnvelope(w, http.StatusOK, map[string]any{
			"token": fake.issueToken(nil, body.DevicePublicKey, time.Now().Add(time.Hour)),
			"plan":  "pro",
		})
	})
	mux.HandleFunc("POST /api/v1/pack-keys/challenge", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			writeEnvelopeError(w, http.StatusUnauthorized, 40110, "license token is required")
			return
		}
		nonce := make([]byte, 32)
		_, _ = rand.Read(nonce)
		writeEnvelope(w, http.StatusOK, map[string]any{"challenge": base64.StdEncoding.EncodeToString(nonce)})
	})
	mux.HandleFunc("POST /api/v1/pack-keys/resolve", func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if strings.TrimSpace(token) == "" {
			writeEnvelopeError(w, http.StatusUnauthorized, 40110, "license token is required")
			return
		}
		var body struct {
			KeyID           string `json:"key_id"`
			Challenge       string `json:"challenge"`
			DeviceSignature string `json:"device_signature"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		// Verify the device proved possession of the private key bound in the token.
		pub := fake.tokenDevicePublicKey(token)
		sig, _ := base64.StdEncoding.DecodeString(body.DeviceSignature)
		if len(pub) != ed25519.PublicKeySize || !ed25519.Verify(pub, []byte(body.Challenge), sig) {
			writeEnvelopeError(w, http.StatusForbidden, 40314, "license is bound to another device")
			return
		}
		writeEnvelope(w, http.StatusOK, map[string]any{
			"key_id": "default",
			"key":    base64.StdEncoding.EncodeToString(fake.packKey),
		})
	})
	mux.HandleFunc("GET /api/v1/publisher-keys", func(w http.ResponseWriter, _ *http.Request) {
		writeEnvelope(w, http.StatusOK, map[string]any{
			"keys": map[string]string{
				"mediago-test": base64.StdEncoding.EncodeToString(make([]byte, 32)),
			},
		})
	})
	fake.server = httptest.NewServer(mux)
	return fake
}

func (fake *fakeLicenseServer) URL() string { return fake.server.URL }

func (fake *fakeLicenseServer) Close() { fake.server.Close() }

func (fake *fakeLicenseServer) publicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(fake.publicKey)
}

func (fake *fakeLicenseServer) issueToken(t *testing.T, devicePublicKey string, expiresAt time.Time) string {
	if t != nil {
		t.Helper()
	}
	payload, _ := json.Marshal(TokenPayload{
		LicenseID:         "lic_test",
		Plan:              "pro",
		Entitlements:      []string{"pack.import.pro"},
		ExpiresAt:         expiresAt.UTC(),
		DevicePublicKey:   devicePublicKey,
		LicenseAPIVersion: "v1",
	})
	signature := ed25519.Sign(fake.private, payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(signature)
}

// tokenDevicePublicKey extracts the bound device public key from a token,
// mirroring how the real server reads it to verify the challenge signature.
func (fake *fakeLicenseServer) tokenDevicePublicKey(token string) []byte {
	parts := strings.SplitN(strings.TrimSpace(token), ".", 2)
	if len(parts) != 2 {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil
	}
	var payload TokenPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	pub, err := base64.StdEncoding.DecodeString(payload.DevicePublicKey)
	if err != nil {
		return nil
	}
	return pub
}

func writeEnvelope(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "message": "success", "data": data})
}

func writeEnvelopeError(w http.ResponseWriter, status int, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "message": message})
}
