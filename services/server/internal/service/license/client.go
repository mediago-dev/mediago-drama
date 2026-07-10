package license

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
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
	deviceID   string
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
		"activation_code": code,
		"device_hash":     client.deviceHash(),
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
	var resolved struct {
		Key string `json:"key"`
	}
	if err := client.postJSON(ctx, "/api/v1/pack-keys/resolve", map[string]string{
		"key_id":      keyID,
		"device_hash": client.deviceHash(),
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

// deviceHash returns a stable fingerprint of this installation. It is derived
// from a random device id persisted next to the license file, so a license
// token copied to another machine (which has its own device id) fails the
// device-binding check. Falls back to host attributes if the id cannot be
// persisted.
func (client *Client) deviceHash() string {
	client.deviceOnce.Do(func() {
		client.deviceID = client.loadOrCreateDeviceID()
	})
	sum := sha256.Sum256([]byte(client.deviceID))
	return hex.EncodeToString(sum[:16])
}

func (client *Client) loadOrCreateDeviceID() string {
	path := filepath.Join(filepath.Dir(client.storePath), "device-id")
	if raw, err := os.ReadFile(path); err == nil {
		if id := strings.TrimSpace(string(raw)); id != "" {
			return id
		}
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		hostname, _ := os.Hostname()
		home, _ := os.UserHomeDir()
		return "host:" + hostname + "|" + home
	}
	id := hex.EncodeToString(buf)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err == nil {
		_ = os.WriteFile(path, []byte(id+"\n"), 0o600)
	}
	return id
}

// tokenMatchesDevice reports whether a token is usable on this device. A token
// with an empty device hash is unbound (dev/legacy) and passes unconditionally.
func (client *Client) tokenMatchesDevice(payload TokenPayload) bool {
	if strings.TrimSpace(payload.DeviceHash) == "" {
		return true
	}
	return payload.DeviceHash == client.deviceHash()
}
