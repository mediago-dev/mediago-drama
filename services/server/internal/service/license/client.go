package license

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	licenseServerURLEnv = "MEDIAGO_LICENSE_SERVER_URL"

	storedLicenseFile = "license.json"

	maxLicenseResponseBytes = 1 << 20
	publisherKeysCacheTTL   = 10 * time.Minute
)

var (
	// ErrNotConfigured indicates no license server URL is configured.
	ErrNotConfigured = errors.New("license server is not configured")
	// ErrNotActivated indicates no stored license token exists.
	ErrNotActivated = errors.New("license is not activated")
	// ErrActivationRejected indicates the license server rejected the code.
	ErrActivationRejected = errors.New("activation was rejected")
	// ErrServerUnavailable indicates the license server could not be reached.
	ErrServerUnavailable = errors.New("license server is unavailable")
)

// Client talks to the private license server and stores the issued token
// locally. It implements Service when a server URL is configured.
type Client struct {
	baseURL    string
	storePath  string
	httpClient *http.Client

	mu             sync.Mutex
	publisherCache map[string][]byte
	publisherAt    time.Time

	deviceOnce sync.Once
	deviceKey  ed25519.PrivateKey
}

var _ Service = (*Client)(nil)

// NewClient builds a license client. baseURL may be empty (not configured);
// stateDir hosts the persisted token file.
func NewClient(baseURL string, stateDir string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		storePath:  filepath.Join(strings.TrimSpace(stateDir), storedLicenseFile),
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// NewFromEnvironment selects the license provider: a remote Client when
// MEDIAGO_LICENSE_SERVER_URL is set, otherwise the env-based DevProvider.
// The returned Client is always non-nil so activation handlers can report
// the unconfigured state.
func NewFromEnvironment(stateDir string) (Service, *Client) {
	client := NewClient(os.Getenv(licenseServerURLEnv), stateDir)
	if client.Configured() {
		return client, client
	}
	return NewDevProvider(), client
}

// Configured reports whether a license server URL is set.
func (client *Client) Configured() bool {
	return client != nil && client.baseURL != ""
}

// StatusInfo describes the local activation state for the settings UI.
type StatusInfo struct {
	Configured   bool     `json:"configured"`
	Activated    bool     `json:"activated"`
	LicenseID    string   `json:"licenseId,omitempty"`
	Plan         string   `json:"plan,omitempty"`
	Entitlements []string `json:"entitlements,omitempty"`
	ExpiresAt    string   `json:"expiresAt,omitempty"`
}

type storedLicense struct {
	Token           string `json:"token"`
	ServerURL       string `json:"serverUrl"`
	ServerPublicKey string `json:"serverPublicKey"`
	SavedAt         string `json:"savedAt"`
}

// Status returns the current activation state, verifying the stored token.
func (client *Client) Status() StatusInfo {
	info := StatusInfo{Configured: client.Configured()}
	stored, err := client.loadStored()
	if err != nil {
		return info
	}
	payload, err := VerifyToken(stored.Token, stored.ServerPublicKey)
	if err != nil && !errors.Is(err, ErrTokenExpired) {
		return info
	}
	// A validly-signed token bound to a different device belongs to another
	// machine (a copied license) — treat this device as not activated.
	if !client.tokenMatchesDevice(payload) {
		return info
	}
	info.LicenseID = payload.LicenseID
	info.Plan = payload.Plan
	info.Entitlements = append([]string(nil), payload.Entitlements...)
	info.ExpiresAt = payload.ExpiresAt.UTC().Format(time.RFC3339)
	info.Activated = err == nil
	return info
}

// Activate redeems an activation code against the license server, verifies
// the issued token with the server's published key, and persists it.
func (client *Client) Activate(ctx context.Context, code string) (StatusInfo, error) {
	if !client.Configured() {
		return client.Status(), ErrNotConfigured
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return client.Status(), fmt.Errorf("%w: activation code is empty", ErrActivationRejected)
	}
	publicKey, err := client.fetchServerPublicKey(ctx)
	if err != nil {
		return client.Status(), err
	}
	var activated struct {
		Token string `json:"token"`
	}
	err = client.postJSON(ctx, "/api/v1/activate", map[string]string{
		"activation_code":   code,
		"device_public_key": client.devicePublicKeyBase64(),
	}, "", &activated)
	if err != nil {
		return client.Status(), err
	}
	if _, err := VerifyToken(activated.Token, publicKey); err != nil {
		return client.Status(), fmt.Errorf("%w: issued token failed verification", ErrActivationRejected)
	}
	if err := client.saveStored(storedLicense{
		Token:           activated.Token,
		ServerURL:       client.baseURL,
		ServerPublicKey: publicKey,
		SavedAt:         time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return client.Status(), err
	}
	return client.Status(), nil
}

// Deactivate removes the stored license token.
func (client *Client) Deactivate() (StatusInfo, error) {
	if err := os.Remove(client.storePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return client.Status(), fmt.Errorf("removing stored license: %w", err)
	}
	return client.Status(), nil
}

// HasEntitlement verifies the stored token locally and checks the grant.
func (client *Client) HasEntitlement(_ context.Context, entitlement string) (bool, error) {
	stored, err := client.loadStored()
	if err != nil {
		return false, nil
	}
	payload, err := VerifyToken(stored.Token, stored.ServerPublicKey)
	if err != nil {
		return false, nil
	}
	if !client.tokenMatchesDevice(payload) {
		return false, nil
	}
	entitlement = strings.TrimSpace(entitlement)
	if entitlement == "" {
		entitlement = defaultProEntitlement
	}
	return payload.HasEntitlement(entitlement), nil
}

// ResolvePackKey exchanges the stored token for a pack decryption key.
func (client *Client) ResolvePackKey(ctx context.Context, keyID string) ([]byte, error) {
	stored, err := client.loadStored()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrPackKeyNotFound, ErrNotActivated)
	}
	payload, err := VerifyToken(stored.Token, stored.ServerPublicKey)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrPackKeyNotFound, err)
	}
	if !client.tokenMatchesDevice(payload) {
		return nil, fmt.Errorf("%w: license is bound to another device", ErrPackKeyNotFound)
	}
	keyID = strings.TrimSpace(keyID)
	if keyID == "" {
		keyID = "default"
	}
	// Prove device possession: fetch a server challenge and sign it with the
	// device private key (which never left this machine and is not in the token).
	var challenged struct {
		Challenge string `json:"challenge"`
	}
	if err := client.postJSON(ctx, "/api/v1/pack-keys/challenge", nil, stored.Token, &challenged); err != nil {
		if errors.Is(err, ErrActivationRejected) {
			return nil, fmt.Errorf("%w: challenge rejected", ErrPackKeyNotFound)
		}
		return nil, err
	}
	signature := ed25519.Sign(client.devicePrivateKey(), []byte(challenged.Challenge))
	var resolved struct {
		Key string `json:"key"`
	}
	if err := client.postJSON(ctx, "/api/v1/pack-keys/resolve", map[string]string{
		"key_id":           keyID,
		"challenge":        challenged.Challenge,
		"device_signature": base64.StdEncoding.EncodeToString(signature),
	}, stored.Token, &resolved); err != nil {
		if errors.Is(err, ErrActivationRejected) {
			return nil, fmt.Errorf("%w: %q", ErrPackKeyNotFound, keyID)
		}
		return nil, err
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(resolved.Key))
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("%w: malformed key %q", ErrPackKeyNotFound, keyID)
	}
	return key, nil
}

// ResolvePublisherKeys fetches (and caches) the trusted publisher key ring.
func (client *Client) ResolvePublisherKeys(ctx context.Context) (map[string][]byte, error) {
	client.mu.Lock()
	if client.publisherCache != nil && time.Since(client.publisherAt) < publisherKeysCacheTTL {
		cached := clonePublisherKeys(client.publisherCache)
		client.mu.Unlock()
		return cached, nil
	}
	client.mu.Unlock()

	var listed struct {
		Keys map[string]string `json:"keys"`
	}
	if err := client.getJSON(ctx, "/api/v1/publisher-keys", &listed); err != nil {
		client.mu.Lock()
		defer client.mu.Unlock()
		if client.publisherCache != nil {
			return clonePublisherKeys(client.publisherCache), nil
		}
		return nil, err
	}
	keys := make(map[string][]byte, len(listed.Keys))
	for keyID, encoded := range listed.Keys {
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil || len(key) != 32 {
			continue
		}
		keys[keyID] = key
	}
	client.mu.Lock()
	client.publisherCache = clonePublisherKeys(keys)
	client.publisherAt = time.Now()
	client.mu.Unlock()
	return keys, nil
}

func (client *Client) fetchServerPublicKey(ctx context.Context) (string, error) {
	var response struct {
		PublicKey string `json:"public_key"`
	}
	if err := client.getJSON(ctx, "/api/v1/license/public-key", &response); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.PublicKey) == "" {
		return "", fmt.Errorf("%w: empty public key", ErrServerUnavailable)
	}
	return strings.TrimSpace(response.PublicKey), nil
}

type serverEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func (client *Client) postJSON(ctx context.Context, path string, body map[string]string, bearer string, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	return client.doJSON(request, out)
}

func (client *Client) getJSON(ctx context.Context, path string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+path, nil)
	if err != nil {
		return err
	}
	return client.doJSON(request, out)
}

func (client *Client) doJSON(request *http.Request, out any) error {
	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrServerUnavailable, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxLicenseResponseBytes))
	if err != nil {
		return fmt.Errorf("%w: reading response", ErrServerUnavailable)
	}
	var envelope serverEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("%w: unexpected response", ErrServerUnavailable)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(envelope.Message)
		if message == "" {
			message = response.Status
		}
		if response.StatusCode >= 500 {
			return fmt.Errorf("%w: %s", ErrServerUnavailable, message)
		}
		return fmt.Errorf("%w: %s", ErrActivationRejected, message)
	}
	if out == nil || len(envelope.Data) == 0 {
		return nil
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return fmt.Errorf("%w: unexpected payload", ErrServerUnavailable)
	}
	return nil
}

func (client *Client) loadStored() (storedLicense, error) {
	raw, err := os.ReadFile(client.storePath)
	if err != nil {
		return storedLicense{}, err
	}
	var stored storedLicense
	if err := json.Unmarshal(raw, &stored); err != nil {
		return storedLicense{}, err
	}
	if strings.TrimSpace(stored.Token) == "" || strings.TrimSpace(stored.ServerPublicKey) == "" {
		return storedLicense{}, errors.New("stored license is incomplete")
	}
	return stored, nil
}

func (client *Client) saveStored(stored storedLicense) error {
	if err := os.MkdirAll(filepath.Dir(client.storePath), 0o700); err != nil {
		return fmt.Errorf("creating license dir: %w", err)
	}
	raw, err := json.MarshalIndent(stored, "", "\t")
	if err != nil {
		return err
	}
	if err := os.WriteFile(client.storePath, raw, 0o600); err != nil {
		return fmt.Errorf("saving license: %w", err)
	}
	return nil
}

func clonePublisherKeys(keys map[string][]byte) map[string][]byte {
	cloned := make(map[string][]byte, len(keys))
	for keyID, key := range keys {
		copied := make([]byte, len(key))
		copy(copied, key)
		cloned[keyID] = copied
	}
	return cloned
}

// deviceKeyOnce loads (or creates) this installation's Ed25519 device keypair.
// The private key is persisted next to the license file and never leaves the
// device; only its public key is bound into the license token. Pack-key
// resolution requires signing a server challenge with the private key, so a
// license token copied to another machine cannot obtain keys.
func (client *Client) devicePrivateKey() ed25519.PrivateKey {
	client.deviceOnce.Do(func() {
		client.deviceKey = client.loadOrCreateDeviceKey()
	})
	return client.deviceKey
}

// devicePublicKeyBase64 returns the base64-std device public key sent at
// activation and matched against the token binding.
func (client *Client) devicePublicKeyBase64() string {
	pub := client.devicePrivateKey().Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub)
}

func (client *Client) loadOrCreateDeviceKey() ed25519.PrivateKey {
	path := filepath.Join(filepath.Dir(client.storePath), "device-key")
	if raw, err := os.ReadFile(path); err == nil {
		if seed, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw))); decodeErr == nil && len(seed) == ed25519.SeedSize {
			return ed25519.NewKeyFromSeed(seed)
		}
	}
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		return machineFallbackKey()
	}
	// If the key cannot be persisted, derive a stable machine-bound key instead
	// of returning this ephemeral one — otherwise every launch would regenerate
	// a different key and silently invalidate an already activated license.
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return machineFallbackKey()
	}
	if err := os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(seed)+"\n"), 0o600); err != nil {
		return machineFallbackKey()
	}
	return ed25519.NewKeyFromSeed(seed)
}

func machineFallbackKey() ed25519.PrivateKey {
	hostname, _ := os.Hostname()
	home, _ := os.UserHomeDir()
	seed := sha256.Sum256([]byte("mediago-device|" + hostname + "|" + home))
	return ed25519.NewKeyFromSeed(seed[:])
}

// tokenMatchesDevice reports whether a token is usable on this device. A token
// with no bound device public key is unbound (dev/legacy) and passes. This is a
// fast local check; the authoritative proof is the server challenge signature.
func (client *Client) tokenMatchesDevice(payload TokenPayload) bool {
	if strings.TrimSpace(payload.DevicePublicKey) == "" {
		return true
	}
	return payload.DevicePublicKey == client.devicePublicKeyBase64()
}
