// Command prepare-rights downloads and stages the private prompt-pack Runtime.
package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	includeRuntimeEnv = "MEDIAGO_INCLUDE_PROTECTED_PACK_RUNTIME"
	privateTokenEnv   = "MEDIAGO_PRIVATE_ARTIFACT_TOKEN"
	releaseTagEnv     = "MEDIAGO_RIGHTS_RELEASE_TAG"

	privateRepository = "mediago-dev/mediago-drama-private"
	manifestAssetName = "mediago-rights-marketplace-tools.json"
	githubAPIBase     = "https://api.github.com"
	maxManifestBytes  = 1 << 20
)

type release struct {
	Assets []releaseAsset `json:"assets"`
}

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type privateToolsManifest map[string]privateToolSpec

type privateToolSpec struct {
	Bin       string                             `json:"bin"`
	Version   string                             `json:"version"`
	Policy    string                             `json:"policy"`
	Platforms map[string]privateToolPlatformSpec `json:"platforms"`
}

type privateToolPlatformSpec struct {
	URL         string `json:"url"`
	ArchivePath string `json:"archivePath"`
	SizeBytes   int64  `json:"sizeBytes"`
	SHA256      string `json:"sha256"`
}

type stagedManifest struct {
	ID           string `json:"id"`
	Bin          string `json:"bin"`
	Version      string `json:"version"`
	Policy       string `json:"policy"`
	Platform     string `json:"platform"`
	URL          string `json:"url"`
	ArchivePath  string `json:"archivePath"`
	SizeBytes    int64  `json:"sizeBytes"`
	SHA256       string `json:"sha256"`
	BinarySHA256 string `json:"binarySha256"`
}

type target struct {
	DistKey      string
	ManifestKey  string
	BinaryName   string
	ArchiveAsset string
}

type preparer struct {
	client  *http.Client
	apiBase string
	token   string
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if strings.TrimSpace(os.Getenv(includeRuntimeEnv)) != "1" {
		fmt.Printf("Skipping mediago-rights because %s is not 1\n", includeRuntimeEnv)
		return nil
	}

	flags := flag.NewFlagSet("prepare-rights", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	targetPlatform := flags.String("platform", "", "Target platform to prepare, e.g. darwin-arm64 or windows-x64")
	root := flags.String("root", "", "Vendor directory containing tools.json")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}

	tag := strings.TrimSpace(os.Getenv(releaseTagEnv))
	if tag == "" {
		return fmt.Errorf("%s is required when %s=1", releaseTagEnv, includeRuntimeEnv)
	}
	token := strings.TrimSpace(os.Getenv(privateTokenEnv))
	if token == "" {
		return fmt.Errorf("%s is required when %s=1", privateTokenEnv, includeRuntimeEnv)
	}
	vendorDir, err := resolveVendorDir(*root)
	if err != nil {
		return err
	}
	resolvedTarget, explicitTarget, err := resolveTarget(*targetPlatform)
	if err != nil {
		return err
	}
	distDir := filepath.Join(vendorDir, "dist", "tools", "mediago-rights")
	if explicitTarget {
		distDir = filepath.Join(vendorDir, "dist", resolvedTarget.DistKey, "tools", "mediago-rights")
	}

	worker := preparer{
		client:  &http.Client{Timeout: 10 * time.Minute},
		apiBase: githubAPIBase,
		token:   token,
	}
	return worker.prepare(context.Background(), tag, resolvedTarget, distDir)
}

func (worker preparer) prepare(ctx context.Context, tag string, target target, distDir string) error {
	release, err := worker.fetchRelease(ctx, tag)
	if err != nil {
		return err
	}
	manifestAsset, err := findReleaseAsset(release, manifestAssetName)
	if err != nil {
		return err
	}
	archiveAsset, err := findReleaseAsset(release, target.ArchiveAsset)
	if err != nil {
		return err
	}
	manifestRaw, err := worker.downloadBytes(ctx, manifestAsset.URL, maxManifestBytes)
	if err != nil {
		return fmt.Errorf("downloading private Runtime manifest: %w", err)
	}
	expected, err := parseExpectedManifest(manifestRaw, tag, target)
	if err != nil {
		return err
	}
	if cached, err := hasPreparedRuntime(distDir, expected); err != nil {
		return err
	} else if cached {
		fmt.Printf("Using cached mediago-rights@%s in %s\n", tag, distDir)
		return nil
	}

	tmpDir, err := os.MkdirTemp("", "mediago-rights-*")
	if err != nil {
		return fmt.Errorf("creating private Runtime temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)
	archivePath := filepath.Join(tmpDir, target.ArchiveAsset)
	fmt.Printf("Downloading mediago-rights@%s for %s\n", tag, target.DistKey)
	if err := worker.downloadFile(ctx, archiveAsset.URL, archivePath); err != nil {
		return fmt.Errorf("downloading private Runtime archive: %w", err)
	}
	if err := verifyArchive(archivePath, expected); err != nil {
		return err
	}
	if err := stageArchive(archivePath, distDir, &expected); err != nil {
		return err
	}
	fmt.Printf("Prepared mediago-rights in %s\n", distDir)
	return nil
}

func (worker preparer) fetchRelease(ctx context.Context, tag string) (release, error) {
	endpoint := strings.TrimRight(worker.apiBase, "/") + "/repos/" + privateRepository + "/releases/tags/" + url.PathEscape(tag)
	raw, err := worker.downloadBytesWithAccept(ctx, endpoint, maxManifestBytes, "application/vnd.github+json")
	if err != nil {
		return release{}, fmt.Errorf("loading private Runtime release %s: %w", tag, err)
	}
	var result release
	if err := json.Unmarshal(raw, &result); err != nil {
		return release{}, fmt.Errorf("parsing private Runtime release %s: %w", tag, err)
	}
	return result, nil
}

func (worker preparer) downloadBytes(ctx context.Context, sourceURL string, maxBytes int64) ([]byte, error) {
	return worker.downloadBytesWithAccept(ctx, sourceURL, maxBytes, "application/octet-stream")
}

func (worker preparer) downloadBytesWithAccept(ctx context.Context, sourceURL string, maxBytes int64, accept string) ([]byte, error) {
	request, err := worker.request(ctx, sourceURL, accept)
	if err != nil {
		return nil, err
	}
	response, err := worker.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("requesting %s: %w", sourceURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("requesting %s: status %s", sourceURL, response.Status)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", sourceURL, err)
	}
	if int64(len(raw)) > maxBytes {
		return nil, fmt.Errorf("reading %s: response exceeds %d bytes", sourceURL, maxBytes)
	}
	return raw, nil
}

func (worker preparer) downloadFile(ctx context.Context, sourceURL string, path string) error {
	request, err := worker.request(ctx, sourceURL, "application/octet-stream")
	if err != nil {
		return err
	}
	response, err := worker.client.Do(request)
	if err != nil {
		return fmt.Errorf("requesting %s: %w", sourceURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("requesting %s: status %s", sourceURL, response.Status)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("creating %s: %w", path, err)
	}
	if _, err := io.Copy(file, response.Body); err != nil {
		file.Close()
		return fmt.Errorf("writing %s: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", path, err)
	}
	return nil
}

func (worker preparer) request(ctx context.Context, sourceURL string, accept string) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request for %s: %w", sourceURL, err)
	}
	request.Header.Set("Accept", accept)
	request.Header.Set("Authorization", "Bearer "+worker.token)
	request.Header.Set("User-Agent", "mediago-vendor-prepare")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	return request, nil
}

func findReleaseAsset(value release, name string) (releaseAsset, error) {
	for _, asset := range value.Assets {
		if asset.Name == name && strings.TrimSpace(asset.URL) != "" {
			return asset, nil
		}
	}
	return releaseAsset{}, fmt.Errorf("private Runtime release is missing asset %s", name)
}

func parseExpectedManifest(raw []byte, tag string, target target) (stagedManifest, error) {
	var manifest privateToolsManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return stagedManifest{}, fmt.Errorf("parsing private Runtime manifest: %w", err)
	}
	tool, ok := manifest["mediago-rights"]
	if !ok {
		return stagedManifest{}, fmt.Errorf("private Runtime manifest is missing mediago-rights")
	}
	if strings.TrimSpace(tool.Bin) != "mediago-rights" {
		return stagedManifest{}, fmt.Errorf("private Runtime bin must be mediago-rights")
	}
	if strings.TrimSpace(tool.Version) != tag || strings.TrimSpace(tool.Policy) != "marketplace" {
		return stagedManifest{}, fmt.Errorf("private Runtime version or policy does not match the release build")
	}
	platform, ok := tool.Platforms[target.ManifestKey]
	if !ok {
		return stagedManifest{}, fmt.Errorf("private Runtime manifest is missing %s", target.ManifestKey)
	}
	assetURL, err := validateAssetURL(platform.URL)
	if err != nil {
		return stagedManifest{}, err
	}
	if platform.SizeBytes <= 0 {
		return stagedManifest{}, fmt.Errorf("private Runtime sizeBytes must be positive")
	}
	digest := strings.ToLower(strings.TrimSpace(platform.SHA256))
	decoded, err := hex.DecodeString(digest)
	if err != nil || len(decoded) != sha256.Size {
		return stagedManifest{}, fmt.Errorf("private Runtime sha256 must contain 64 hexadecimal characters")
	}
	archivePath := filepath.ToSlash(strings.TrimSpace(platform.ArchivePath))
	if archivePath != target.BinaryName {
		return stagedManifest{}, fmt.Errorf("private Runtime archivePath must be %s", target.BinaryName)
	}
	return stagedManifest{
		ID:          "mediago-rights",
		Bin:         target.BinaryName,
		Version:     tag,
		Policy:      "marketplace",
		Platform:    target.ManifestKey,
		URL:         assetURL,
		ArchivePath: archivePath,
		SizeBytes:   platform.SizeBytes,
		SHA256:      digest,
	}, nil
}

func validateAssetURL(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil ||
		(parsed.Hostname() != "github.com" && parsed.Hostname() != "api.github.com") {
		return "", fmt.Errorf("private Runtime URL must use HTTPS on GitHub without user information")
	}
	return trimmed, nil
}

func verifyArchive(path string, expected stagedManifest) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("opening private Runtime archive: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("checking private Runtime archive: %w", err)
	}
	if info.Size() != expected.SizeBytes {
		return fmt.Errorf("private Runtime size is %d, expected %d", info.Size(), expected.SizeBytes)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hashing private Runtime archive: %w", err)
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if actual != expected.SHA256 {
		return fmt.Errorf("private Runtime sha256 is %s, expected %s", actual, expected.SHA256)
	}
	return nil
}

func stageArchive(archivePath string, distDir string, manifest *stagedManifest) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("opening private Runtime archive: %w", err)
	}
	defer reader.Close()
	files := make([]*zip.File, 0, 1)
	for _, entry := range reader.File {
		if !entry.FileInfo().IsDir() {
			files = append(files, entry)
		}
	}
	if len(files) != 1 || filepath.ToSlash(files[0].Name) != manifest.ArchivePath {
		names := make([]string, 0, len(files))
		for _, entry := range files {
			names = append(names, entry.Name)
		}
		return fmt.Errorf("private Runtime archive entries are invalid: %v", names)
	}
	input, err := files[0].Open()
	if err != nil {
		return fmt.Errorf("opening private Runtime binary in archive: %w", err)
	}
	defer input.Close()

	if err := os.RemoveAll(distDir); err != nil {
		return fmt.Errorf("cleaning %s: %w", distDir, err)
	}
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", distDir, err)
	}
	binaryPath := filepath.Join(distDir, manifest.Bin)
	output, err := os.OpenFile(binaryPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("creating %s: %w", binaryPath, err)
	}
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(output, hash), input); err != nil {
		output.Close()
		return fmt.Errorf("writing %s: %w", binaryPath, err)
	}
	if err := output.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", binaryPath, err)
	}
	if err := os.Chmod(binaryPath, 0o755); err != nil {
		return fmt.Errorf("marking %s executable: %w", binaryPath, err)
	}
	manifest.BinarySHA256 = hex.EncodeToString(hash.Sum(nil))
	return writeStagedManifest(distDir, *manifest)
}

func hasPreparedRuntime(distDir string, expected stagedManifest) (bool, error) {
	raw, err := os.ReadFile(filepath.Join(distDir, "tool.json"))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading cached private Runtime manifest: %w", err)
	}
	var cached stagedManifest
	if err := json.Unmarshal(raw, &cached); err != nil {
		return false, fmt.Errorf("parsing cached private Runtime manifest: %w", err)
	}
	if cached.ID != expected.ID || cached.Bin != expected.Bin || cached.Version != expected.Version ||
		cached.Policy != expected.Policy || cached.Platform != expected.Platform || cached.URL != expected.URL ||
		cached.ArchivePath != expected.ArchivePath || cached.SizeBytes != expected.SizeBytes ||
		cached.SHA256 != expected.SHA256 || len(cached.BinarySHA256) != sha256.Size*2 {
		return false, nil
	}
	binaryPath := filepath.Join(distDir, expected.Bin)
	file, err := os.Open(binaryPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("opening cached private Runtime: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return false, fmt.Errorf("hashing cached private Runtime: %w", err)
	}
	return hex.EncodeToString(hash.Sum(nil)) == strings.ToLower(cached.BinarySHA256), nil
}

func writeStagedManifest(distDir string, manifest stagedManifest) error {
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding private Runtime manifest: %w", err)
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(filepath.Join(distDir, "tool.json"), raw, 0o644); err != nil {
		return fmt.Errorf("writing private Runtime manifest: %w", err)
	}
	return nil
}

func resolveTarget(value string) (target, bool, error) {
	value = strings.TrimSpace(value)
	explicit := value != ""
	if value == "" {
		switch {
		case runtime.GOOS == "darwin" && runtime.GOARCH == "arm64":
			value = "darwin-arm64"
		case runtime.GOOS == "windows" && runtime.GOARCH == "amd64":
			value = "windows-x64"
		default:
			return target{}, false, fmt.Errorf("mediago-rights does not support local platform %s-%s", runtime.GOOS, runtime.GOARCH)
		}
	}
	switch value {
	case "darwin-arm64":
		return target{
			DistKey:      value,
			ManifestKey:  "darwin-arm64",
			BinaryName:   "mediago-rights",
			ArchiveAsset: "mediago-rights-marketplace-darwin-arm64.zip",
		}, explicit, nil
	case "windows-x64":
		return target{
			DistKey:      value,
			ManifestKey:  "win32-x64",
			BinaryName:   "mediago-rights.exe",
			ArchiveAsset: "mediago-rights-marketplace-windows-x64.zip",
		}, explicit, nil
	default:
		return target{}, explicit, fmt.Errorf("unsupported private Runtime target: %s", value)
	}
}

func resolveVendorDir(root string) (string, error) {
	root = strings.TrimSpace(root)
	if root != "" {
		return filepath.Abs(root)
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("reading working directory: %w", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "tools.json")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not find tools.json from %s", dir)
		}
		dir = parent
	}
}
