package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
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
	"sort"
	"strings"
	"time"
)

const (
	defaultAgentID = "codex"
	npmRegistryURL = "https://registry.npmjs.org"
)

type agentSpec struct {
	Package string   `json:"package"`
	Bin     string   `json:"bin"`
	Args    []string `json:"args"`
	Version string   `json:"version"`
}
type agentManifest struct {
	ID           string   `json:"id"`
	Bin          string   `json:"bin"`
	Args         []string `json:"args"`
	Version      string   `json:"version"`
	CodexBin     string   `json:"codexBin,omitempty"`
	CodexVersion string   `json:"codexVersion,omitempty"`
}
type platform struct{ OS, Arch string }
type npmPackageVersionMetadata struct{ Dist struct{ Tarball string } }

func npmRegistryPackageVersionURL(registryBase string, packageName string, version string) (string, error) {
	registryBase = strings.TrimRight(strings.TrimSpace(registryBase), "/")
	packageName = strings.TrimSpace(packageName)
	version = strings.TrimSpace(version)
	if registryBase == "" || packageName == "" || version == "" {
		return "", fmt.Errorf("npm registry base, package, and version are required")
	}
	return registryBase + "/" + url.PathEscape(packageName) + "/" + url.PathEscape(version), nil
}

func npmPackageTarballURL(client *http.Client, registryBase string, packageName string, version string) (string, error) {
	metadataURL, err := npmRegistryPackageVersionURL(registryBase, packageName, version)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequest(http.MethodGet, metadataURL, nil)
	if err != nil {
		return "", fmt.Errorf("creating npm metadata request: %w", err)
	}
	request.Header.Set("User-Agent", "mediago-vendor-prepare")
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("fetching npm metadata %s@%s: %w", packageName, version, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("fetching npm metadata %s@%s: status %s", packageName, version, response.Status)
	}
	var metadata npmPackageVersionMetadata
	if err := json.NewDecoder(io.LimitReader(response.Body, 1024*1024)).Decode(&metadata); err != nil {
		return "", fmt.Errorf("decoding npm metadata %s@%s: %w", packageName, version, err)
	}
	tarball := strings.TrimSpace(metadata.Dist.Tarball)
	parsed, err := url.Parse(tarball)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", fmt.Errorf("npm metadata %s@%s has invalid tarball URL", packageName, version)
	}
	return tarball, nil
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
		if _, err := os.Stat(filepath.Join(dir, "agents.json")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not find agents.json from %s", dir)
		}
		dir = parent
	}
}

func loadAgentSpecs(path string) (map[string]agentSpec, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	specs := map[string]agentSpec{}
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
		detected.OS = "windows"
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

func resolvePlatform(value string) (platform, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return detectPlatform()
	}
	parts := strings.Split(value, "-")
	if len(parts) != 2 {
		return platform{}, fmt.Errorf("platform must look like os-arch, got %q", value)
	}

	var detected platform
	switch parts[0] {
	case "darwin", "linux", "windows":
		detected.OS = parts[0]
	case "win32":
		detected.OS = "windows"
	default:
		return platform{}, fmt.Errorf("unsupported platform OS: %s", parts[0])
	}

	switch parts[1] {
	case "arm64":
		detected.Arch = "arm64"
	case "x64", "amd64":
		detected.Arch = "x64"
	default:
		return platform{}, fmt.Errorf("unsupported platform architecture: %s", parts[1])
	}
	return detected, nil
}

func (value platform) String() string {
	return value.OS + "-" + value.Arch
}

func codexTarget(detected platform) (string, error) {
	switch detected {
	case platform{OS: "darwin", Arch: "arm64"}:
		return "aarch64-apple-darwin", nil
	case platform{OS: "darwin", Arch: "x64"}:
		return "x86_64-apple-darwin", nil
	case platform{OS: "linux", Arch: "arm64"}:
		return "aarch64-unknown-linux-musl", nil
	case platform{OS: "linux", Arch: "x64"}:
		return "x86_64-unknown-linux-musl", nil
	case platform{OS: "windows", Arch: "arm64"}:
		return "aarch64-pc-windows-msvc", nil
	case platform{OS: "windows", Arch: "x64"}:
		return "x86_64-pc-windows-msvc", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", detected.OS, detected.Arch)
	}
}

func hasPreparedAgent(distDir string, expected agentManifest) (bool, error) {
	manifestPath := filepath.Join(distDir, "agent.json")
	raw, err := os.ReadFile(manifestPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading cached manifest %s: %w", manifestPath, err)
	}

	var manifest agentManifest
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
	if strings.TrimSpace(expected.CodexBin) != "" {
		if err := ensureExecutable(filepath.Join(distDir, expected.CodexBin)); errors.Is(err, os.ErrNotExist) {
			return false, nil
		} else if err != nil {
			return false, err
		}
	}
	return true, nil
}

func manifestMatches(got agentManifest, want agentManifest) bool {
	if strings.TrimSpace(got.ID) != want.ID ||
		strings.TrimSpace(got.Bin) != want.Bin ||
		strings.TrimSpace(got.Version) != want.Version ||
		strings.TrimSpace(got.CodexBin) != want.CodexBin ||
		strings.TrimSpace(got.CodexVersion) != want.CodexVersion ||
		len(got.Args) != len(want.Args) {
		return false
	}
	for index := range got.Args {
		if strings.TrimSpace(got.Args[index]) != want.Args[index] {
			return false
		}
	}
	return true
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

func downloadURL(client *http.Client, sourceURL string, out string) error {
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return fmt.Errorf("creating download directory: %w", err)
	}
	request, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return fmt.Errorf("creating download request: %w", err)
	}
	request.Header.Set("User-Agent", "mediago-vendor-prepare")

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("downloading %s: %w", sourceURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("downloading %s: status %s", sourceURL, response.Status)
	}

	file, err := os.Create(out)
	if err != nil {
		return fmt.Errorf("creating %s: %w", out, err)
	}
	if _, err := io.Copy(file, response.Body); err != nil {
		file.Close()
		return fmt.Errorf("writing %s: %w", out, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", out, err)
	}
	return nil
}

func extractArchive(archivePath string, destDir string) error {
	if err := os.RemoveAll(destDir); err != nil {
		return fmt.Errorf("cleaning extract dir: %w", err)
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("creating extract dir: %w", err)
	}

	switch {
	case strings.HasSuffix(archivePath, ".tar.gz"), strings.HasSuffix(archivePath, ".tgz"):
		return extractTarGZ(archivePath, destDir)
	case strings.HasSuffix(archivePath, ".zip"):
		return extractZip(archivePath, destDir)
	default:
		return fmt.Errorf("unsupported archive format: %s", archivePath)
	}
}

func extractTarGZ(archivePath string, destDir string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("opening %s: %w", archivePath, err)
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("opening gzip stream %s: %w", archivePath, err)
	}
	defer gzipReader.Close()

	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reading tar entry %s: %w", archivePath, err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		target, err := safeExtractPath(destDir, header.Name)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("creating directory for %s: %w", target, err)
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(header.Mode)&0o777)
		if err != nil {
			return fmt.Errorf("creating %s: %w", target, err)
		}
		if _, err := io.Copy(out, reader); err != nil {
			out.Close()
			return fmt.Errorf("extracting %s: %w", target, err)
		}
		if err := out.Close(); err != nil {
			return fmt.Errorf("closing %s: %w", target, err)
		}
	}
}

func extractZip(archivePath string, destDir string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("opening %s: %w", archivePath, err)
	}
	defer reader.Close()

	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		target, err := safeExtractPath(destDir, file.Name)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("creating directory for %s: %w", target, err)
		}
		input, err := file.Open()
		if err != nil {
			return fmt.Errorf("opening zip entry %s: %w", file.Name, err)
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, file.Mode()&0o777)
		if err != nil {
			input.Close()
			return fmt.Errorf("creating %s: %w", target, err)
		}
		if _, err := io.Copy(out, input); err != nil {
			input.Close()
			out.Close()
			return fmt.Errorf("extracting %s: %w", target, err)
		}
		if err := input.Close(); err != nil {
			out.Close()
			return fmt.Errorf("closing zip entry %s: %w", file.Name, err)
		}
		if err := out.Close(); err != nil {
			return fmt.Errorf("closing %s: %w", target, err)
		}
	}
	return nil
}

func safeExtractPath(destDir string, name string) (string, error) {
	if strings.HasPrefix(name, "/") || strings.HasPrefix(name, `\`) || strings.Contains(name, ":") {
		return "", fmt.Errorf("invalid archive path: %s", name)
	}
	cleanName := filepath.Clean(name)
	if cleanName == "." || filepath.IsAbs(cleanName) || strings.HasPrefix(cleanName, ".."+string(filepath.Separator)) || cleanName == ".." {
		return "", fmt.Errorf("archive entry escapes destination: %s", name)
	}
	target := filepath.Join(destDir, cleanName)
	rel, err := filepath.Rel(destDir, target)
	if err != nil {
		return "", fmt.Errorf("checking archive entry %s: %w", name, err)
	}
	if strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return "", fmt.Errorf("archive entry escapes destination: %s", name)
	}
	return target, nil
}

func copyDirectory(source string, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			input.Close()
			return err
		}
		if _, err := io.Copy(output, input); err != nil {
			input.Close()
			output.Close()
			return err
		}
		if err := input.Close(); err != nil {
			output.Close()
			return err
		}
		return output.Close()
	})
}

func writeManifest(distDir string, manifest agentManifest) error {
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding manifest: %w", err)
	}
	raw = append(raw, '\n')
	path := filepath.Join(distDir, "agent.json")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}

func agentBinaryName(bin string, detected platform) string {
	bin = strings.TrimSpace(bin)
	if detected.OS == "windows" && bin != "" && !strings.HasSuffix(strings.ToLower(bin), ".exe") {
		return bin + ".exe"
	}
	return bin
}

func agentIDs(specs map[string]agentSpec) []string {
	ids := make([]string, 0, len(specs))
	for id := range specs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string) error {
	flags := flag.NewFlagSet("prepare-agent", flag.ContinueOnError)
	id := flags.String("agent", "codex", "Agent to prepare (codex)")
	target := flags.String("platform", "", "Target platform")
	root := flags.String("root", "", "Vendor directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() == 1 {
		*id = flags.Arg(0)
	} else if flags.NArg() > 1 {
		return fmt.Errorf("unexpected arguments")
	}
	if *id != "codex" {
		return fmt.Errorf("only the native Codex runtime is supported")
	}
	vendorDir, err := resolveVendorDir(*root)
	if err != nil {
		return err
	}
	specs, err := loadAgentSpecs(filepath.Join(vendorDir, "agents.json"))
	if err != nil {
		return err
	}
	spec, ok := specs["codex"]
	if !ok || spec.Version == "" {
		return fmt.Errorf("Codex version must be pinned")
	}
	detected, err := resolvePlatform(*target)
	if err != nil {
		return err
	}
	triple, err := codexTarget(detected)
	if err != nil {
		return err
	}
	dist := filepath.Join(vendorDir, "dist", "codex")
	if *target != "" {
		dist = filepath.Join(vendorDir, "dist", detected.String(), "codex")
	}
	// All removals are restricted to this resolved vendor output directory.
	absolute, err := filepath.Abs(dist)
	if err != nil {
		return err
	}
	base, err := filepath.Abs(filepath.Join(vendorDir, "dist"))
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(base, absolute)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("invalid vendor output path")
	}
	expected := agentManifest{ID: "codex", Bin: filepath.Join("runtime", "bin", agentBinaryName("codex", detected)), Args: []string{}, Version: spec.Version, CodexVersion: spec.Version}
	expected.CodexBin = expected.Bin
	if ready, err := hasPreparedAgent(dist, expected); err != nil {
		return err
	} else if ready {
		fmt.Printf("Using cached native Codex %s in %s\n", spec.Version, dist)
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dist), 0o755); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(filepath.Dir(dist), ".native-codex-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	// A previous bundle may already contain the exact pinned native distribution.
	reused := false
	if raw, err := os.ReadFile(filepath.Join(dist, "agent.json")); err == nil {
		var old agentManifest
		if json.Unmarshal(raw, &old) == nil && old.CodexVersion == spec.Version && old.CodexBin != "" {
			oldPath := filepath.Clean(filepath.Join(dist, old.CodexBin))
			relative, err := filepath.Rel(dist, oldPath)
			if err == nil && !strings.HasPrefix(relative, "..") && !filepath.IsAbs(relative) && ensureExecutable(oldPath) == nil {
				source := filepath.Dir(filepath.Dir(oldPath))
				if err := copyDirectory(source, filepath.Join(staging, "runtime")); err != nil {
					return err
				}
				reused = true
			}
		}
	}
	if !reused {
		packagePlatform := detected.OS + "-" + detected.Arch
		if detected.OS == "windows" {
			packagePlatform = "win32-" + detected.Arch
		}
		client := &http.Client{Timeout: 10 * time.Minute}
		tarball, err := npmPackageTarballURL(client, npmRegistryURL, spec.Package, spec.Version+"-"+packagePlatform)
		if err != nil {
			return err
		}
		tmp, err := os.MkdirTemp("", "mediago-native-codex-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tmp)
		archive := filepath.Join(tmp, "codex.tgz")
		if err := downloadURL(client, tarball, archive); err != nil {
			return err
		}
		if err := extractArchive(archive, filepath.Join(tmp, "unpack")); err != nil {
			return err
		}
		if err := copyDirectory(filepath.Join(tmp, "unpack", "package", "vendor", triple), filepath.Join(staging, "runtime")); err != nil {
			return err
		}
	}
	if err := ensureExecutable(filepath.Join(staging, expected.Bin)); err != nil {
		return err
	}
	if err := writeManifest(staging, expected); err != nil {
		return err
	}
	backup := dist + ".previous"
	if _, err := os.Stat(backup); err == nil {
		return fmt.Errorf("previous Codex installation backup exists: %s", backup)
	}
	hadOld := false
	if _, err := os.Stat(dist); err == nil {
		if err := os.Rename(dist, backup); err != nil {
			return err
		}
		hadOld = true
	}
	if err := os.Rename(staging, dist); err != nil {
		if hadOld {
			_ = os.Rename(backup, dist)
		}
		return err
	}
	if hadOld {
		if err := os.RemoveAll(backup); err != nil {
			return err
		}
	}
	fmt.Printf("Prepared native Codex %s in %s\n", spec.Version, dist)
	return nil
}
