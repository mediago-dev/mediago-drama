package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const defaultToolID = "ffmpeg"

type toolSpec struct {
	Bin       string                      `json:"bin"`
	Version   string                      `json:"version"`
	Platforms map[string]toolPlatformSpec `json:"platforms"`
}

type toolPlatformSpec struct {
	URL         string `json:"url"`
	ArchivePath string `json:"archivePath,omitempty"`
	SizeBytes   int64  `json:"sizeBytes,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
}

type toolManifest struct {
	ID          string `json:"id"`
	Bin         string `json:"bin"`
	Version     string `json:"version"`
	Platform    string `json:"platform"`
	URL         string `json:"url"`
	ArchivePath string `json:"archivePath,omitempty"`
	SizeBytes   int64  `json:"sizeBytes,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
}

type platform struct {
	OS   string
	Arch string
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	flags := flag.NewFlagSet("prepare-tool", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	toolID := flags.String("tool", defaultToolID, "Tool id to prepare from tools.json")
	targetPlatform := flags.String("platform", "", "Target platform to prepare, e.g. darwin-arm64 or windows-x64")
	root := flags.String("root", "", "Vendor directory containing tools.json")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 1 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	if flags.NArg() == 1 && strings.TrimSpace(*toolID) == defaultToolID {
		*toolID = flags.Arg(0)
	}

	vendorDir, err := resolveVendorDir(*root)
	if err != nil {
		return err
	}
	specs, err := loadToolSpecs(filepath.Join(vendorDir, "tools.json"))
	if err != nil {
		return err
	}

	toolIDValue := canonicalToolID(*toolID)
	spec, ok := specs[toolIDValue]
	if !ok {
		return fmt.Errorf("unsupported tool %q; must be one of: %s", toolIDValue, strings.Join(toolIDs(specs), ", "))
	}
	if strings.TrimSpace(spec.Version) == "" {
		return fmt.Errorf("tool %q has no pinned version in tools.json", toolIDValue)
	}
	currentPlatform, distPlatformKey, err := resolvePlatform(*targetPlatform)
	if err != nil {
		return err
	}
	platformKey := currentPlatform.String()
	asset, ok := spec.Platforms[platformKey]
	if !ok {
		return fmt.Errorf("tool %q does not support platform %s", toolIDValue, platformKey)
	}

	distDir := filepath.Join(vendorDir, "dist", "tools", toolIDValue)
	if strings.TrimSpace(*targetPlatform) != "" {
		distDir = filepath.Join(vendorDir, "dist", distPlatformKey, "tools", toolIDValue)
	}
	return prepareTool(toolIDValue, spec, platformKey, asset, distDir)
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

func loadToolSpecs(path string) (map[string]toolSpec, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	specs := map[string]toolSpec{}
	if err := json.Unmarshal(raw, &specs); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return specs, nil
}

func detectPlatform() (platform, error) {
	var detected platform
	switch runtime.GOOS {
	case "darwin":
		detected.OS = "darwin"
	case "linux":
		detected.OS = "linux"
	case "windows":
		detected.OS = "win32"
	default:
		return platform{}, fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}

	switch runtime.GOARCH {
	case "arm64":
		detected.Arch = "arm64"
	case "amd64":
		detected.Arch = "x64"
	default:
		return platform{}, fmt.Errorf("unsupported architecture: %s", runtime.GOARCH)
	}
	return detected, nil
}

func resolvePlatform(value string) (platform, string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		detected, err := detectPlatform()
		if err != nil {
			return platform{}, "", err
		}
		return detected, detected.DistKey(), nil
	}
	parts := strings.Split(value, "-")
	if len(parts) != 2 {
		return platform{}, "", fmt.Errorf("platform must look like os-arch, got %q", value)
	}

	var detected platform
	distOS := parts[0]
	switch parts[0] {
	case "darwin", "linux":
		detected.OS = parts[0]
	case "windows":
		detected.OS = "win32"
	case "win32":
		detected.OS = "win32"
		distOS = "windows"
	default:
		return platform{}, "", fmt.Errorf("unsupported platform OS: %s", parts[0])
	}

	switch parts[1] {
	case "arm64":
		detected.Arch = "arm64"
	case "x64", "amd64":
		detected.Arch = "x64"
	default:
		return platform{}, "", fmt.Errorf("unsupported platform architecture: %s", parts[1])
	}
	return detected, distOS + "-" + detected.Arch, nil
}

func (value platform) String() string {
	return value.OS + "-" + value.Arch
}

func (value platform) DistKey() string {
	if value.OS == "win32" {
		return "windows-" + value.Arch
	}
	return value.String()
}

func prepareTool(id string, spec toolSpec, platformKey string, asset toolPlatformSpec, distDir string) error {
	expected := toolManifest{
		ID:          id,
		Bin:         toolBinaryName(spec.Bin, platformKey),
		Version:     strings.TrimSpace(spec.Version),
		Platform:    platformKey,
		URL:         strings.TrimSpace(asset.URL),
		ArchivePath: normalizeArchivePath(asset.ArchivePath),
		SizeBytes:   asset.SizeBytes,
		SHA256:      normalizeSHA256(asset.SHA256),
	}
	if expected.Bin == "" {
		return fmt.Errorf("tool %q has empty bin", id)
	}
	if expected.URL == "" {
		return fmt.Errorf("tool %q platform %s has empty url", id, platformKey)
	}
	if cached, err := hasPreparedTool(distDir, expected); err != nil {
		return err
	} else if cached {
		fmt.Printf("Using cached %s@%s in %s\n", id, expected.Version, distDir)
		return nil
	}

	tmpDir, err := os.MkdirTemp("", "mediago-tool-*")
	if err != nil {
		return fmt.Errorf("creating temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	downloadPath := filepath.Join(tmpDir, "download")
	fmt.Printf("Downloading %s@%s: %s\n", id, expected.Version, expected.URL)
	if err := downloadToolAsset(expected.URL, downloadPath); err != nil {
		return err
	}
	if err := verifyDownloadedTool(downloadPath, expected); err != nil {
		return err
	}

	if err := os.RemoveAll(distDir); err != nil {
		return fmt.Errorf("cleaning %s: %w", distDir, err)
	}
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", distDir, err)
	}
	if err := installDownloadedTool(downloadPath, expected, distDir); err != nil {
		return err
	}
	if err := writeManifest(distDir, expected); err != nil {
		return err
	}
	fmt.Printf("Prepared %s in %s\n", id, distDir)
	return nil
}

func hasPreparedTool(distDir string, expected toolManifest) (bool, error) {
	manifestPath := filepath.Join(distDir, "tool.json")
	raw, err := os.ReadFile(manifestPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading cached manifest %s: %w", manifestPath, err)
	}

	var manifest toolManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return false, fmt.Errorf("parsing cached manifest %s: %w", manifestPath, err)
	}
	if !manifestMatches(manifest, expected) {
		return false, nil
	}
	if err := ensureExecutable(filepath.Join(distDir, expected.Bin)); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, nil
}

func manifestMatches(got toolManifest, want toolManifest) bool {
	return strings.TrimSpace(got.ID) == want.ID &&
		strings.TrimSpace(got.Bin) == want.Bin &&
		strings.TrimSpace(got.Version) == want.Version &&
		strings.TrimSpace(got.Platform) == want.Platform &&
		strings.TrimSpace(got.URL) == want.URL &&
		normalizeArchivePath(got.ArchivePath) == want.ArchivePath &&
		got.SizeBytes == want.SizeBytes &&
		normalizeSHA256(got.SHA256) == want.SHA256
}

func ensureExecutable(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("cached binary %s is a directory", path)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return fmt.Errorf("cached binary %s is not executable", path)
	}
	return nil
}

func downloadToolAsset(url string, out string) error {
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return fmt.Errorf("creating download directory: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Minute}
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("creating download request: %w", err)
	}
	request.Header.Set("User-Agent", "mediago-vendor-prepare")

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("downloading %s: %w", url, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("downloading %s: status %s", url, response.Status)
	}

	file, err := os.Create(out)
	if err != nil {
		return fmt.Errorf("creating %s: %w", out, err)
	}
	defer file.Close()
	if _, err := io.Copy(file, response.Body); err != nil {
		return fmt.Errorf("writing %s: %w", out, err)
	}
	return nil
}

func verifyDownloadedTool(path string, expected toolManifest) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("checking downloaded tool: %w", err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("downloaded tool is empty")
	}
	if expected.SizeBytes > 0 && info.Size() != expected.SizeBytes {
		return fmt.Errorf("downloaded tool size = %d, want %d", info.Size(), expected.SizeBytes)
	}
	if expected.SHA256 == "" {
		return nil
	}

	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("opening downloaded tool: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hashing downloaded tool: %w", err)
	}
	got := hex.EncodeToString(hash.Sum(nil))
	if got != expected.SHA256 {
		return fmt.Errorf("downloaded tool sha256 = %s, want %s", got, expected.SHA256)
	}
	return nil
}

func installDownloadedTool(downloadPath string, expected toolManifest, distDir string) error {
	if expected.ArchivePath != "" {
		return installArchivedTool(downloadPath, expected, distDir)
	}
	return installRawTool(downloadPath, expected.Bin, distDir)
}

func installRawTool(downloadPath string, bin string, distDir string) error {
	input, err := os.Open(downloadPath)
	if err != nil {
		return fmt.Errorf("opening downloaded tool %s: %w", downloadPath, err)
	}
	defer input.Close()

	dest := filepath.Join(distDir, bin)
	output, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("creating %s: %w", dest, err)
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return fmt.Errorf("writing %s: %w", dest, err)
	}
	if err := output.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", dest, err)
	}
	if err := os.Chmod(dest, 0o755); err != nil {
		return fmt.Errorf("marking %s executable: %w", dest, err)
	}
	return nil
}

func installArchivedTool(downloadPath string, expected toolManifest, distDir string) error {
	switch {
	case strings.HasSuffix(strings.ToLower(expected.URL), ".zip"):
		return installZipTool(downloadPath, expected, distDir)
	case strings.HasSuffix(strings.ToLower(expected.URL), ".tar.gz"), strings.HasSuffix(strings.ToLower(expected.URL), ".tgz"):
		return installTarGzTool(downloadPath, expected, distDir)
	default:
		return fmt.Errorf("tool %q archivePath is set but url is not a supported archive: %s", expected.ID, expected.URL)
	}
}

func installZipTool(downloadPath string, expected toolManifest, distDir string) error {
	reader, err := zip.OpenReader(downloadPath)
	if err != nil {
		return fmt.Errorf("opening zip archive %s: %w", downloadPath, err)
	}
	defer reader.Close()

	for _, file := range reader.File {
		if normalizeArchivePath(file.Name) != expected.ArchivePath {
			continue
		}
		if file.FileInfo().IsDir() {
			return fmt.Errorf("archive path %s is a directory", expected.ArchivePath)
		}
		input, err := file.Open()
		if err != nil {
			return fmt.Errorf("opening %s in archive: %w", expected.ArchivePath, err)
		}
		defer input.Close()
		return writeExecutable(input, filepath.Join(distDir, expected.Bin))
	}
	return fmt.Errorf("archive path %s was not found in %s", expected.ArchivePath, downloadPath)
}

func installTarGzTool(downloadPath string, expected toolManifest, distDir string) error {
	file, err := os.Open(downloadPath)
	if err != nil {
		return fmt.Errorf("opening tar.gz archive %s: %w", downloadPath, err)
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("opening gzip stream %s: %w", downloadPath, err)
	}
	defer gzipReader.Close()

	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("reading tar archive %s: %w", downloadPath, err)
		}
		if normalizeArchivePath(header.Name) != expected.ArchivePath {
			continue
		}
		if header.FileInfo().IsDir() {
			return fmt.Errorf("archive path %s is a directory", expected.ArchivePath)
		}
		return writeExecutable(tarReader, filepath.Join(distDir, expected.Bin))
	}
	return fmt.Errorf("archive path %s was not found in %s", expected.ArchivePath, downloadPath)
}

func writeExecutable(input io.Reader, dest string) error {
	output, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("creating %s: %w", dest, err)
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return fmt.Errorf("writing %s: %w", dest, err)
	}
	if err := output.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", dest, err)
	}
	if err := os.Chmod(dest, 0o755); err != nil {
		return fmt.Errorf("marking %s executable: %w", dest, err)
	}
	return nil
}

func writeManifest(distDir string, manifest toolManifest) error {
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding manifest: %w", err)
	}
	raw = append(raw, '\n')
	path := filepath.Join(distDir, "tool.json")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}

func normalizeSHA256(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "sha256:")))
}

func normalizeArchivePath(value string) string {
	value = strings.TrimSpace(filepath.ToSlash(value))
	value = strings.TrimPrefix(value, "./")
	return value
}

func canonicalToolID(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "xiaoyunque", "pippit-tool-cli":
		return "pippit"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func toolBinaryName(bin string, platformKey string) string {
	bin = strings.TrimSpace(bin)
	if strings.HasPrefix(platformKey, "win32-") && bin != "" && !strings.HasSuffix(strings.ToLower(bin), ".exe") {
		return bin + ".exe"
	}
	return bin
}

func toolIDs(specs map[string]toolSpec) []string {
	ids := make([]string, 0, len(specs))
	for id := range specs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
