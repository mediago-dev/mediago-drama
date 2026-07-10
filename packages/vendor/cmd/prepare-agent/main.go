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
	"os/exec"
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
	Distribution string   `json:"distribution,omitempty"`
	Repo         string   `json:"repo,omitempty"`
	Package      string   `json:"package,omitempty"`
	Bin          string   `json:"bin"`
	Args         []string `json:"args"`
	Version      string   `json:"version"`
	CodexPackage string   `json:"codexPackage,omitempty"`
	CodexVersion string   `json:"codexVersion,omitempty"`
	BunVersion   string   `json:"bunVersion,omitempty"`
}

type agentManifest struct {
	ID           string   `json:"id"`
	Bin          string   `json:"bin"`
	Args         []string `json:"args"`
	Version      string   `json:"version"`
	CodexBin     string   `json:"codexBin,omitempty"`
	CodexVersion string   `json:"codexVersion,omitempty"`
}

type codexBundlePlatform struct {
	BunTarget           string
	CodexPackageVersion string
	CodexTarget         string
	CodexBin            string
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
	flags := flag.NewFlagSet("prepare-agent", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	agentID := flags.String("agent", defaultAgentID, "Agent id to prepare: codex or opencode")
	targetPlatform := flags.String("platform", "", "Target platform to prepare, e.g. darwin-arm64 or windows-x64")
	root := flags.String("root", "", "Vendor directory containing agents.json")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 1 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	if flags.NArg() == 1 && strings.TrimSpace(*agentID) == defaultAgentID {
		*agentID = flags.Arg(0)
	}

	vendorDir, err := resolveVendorDir(*root)
	if err != nil {
		return err
	}
	specs, err := loadAgentSpecs(filepath.Join(vendorDir, "agents.json"))
	if err != nil {
		return err
	}

	agentIDValue := strings.TrimSpace(*agentID)
	spec, ok := specs[agentIDValue]
	if !ok {
		return fmt.Errorf("unsupported agent %q; must be one of: %s", agentIDValue, strings.Join(agentIDs(specs), ", "))
	}

	currentPlatform, err := resolvePlatform(*targetPlatform)
	if err != nil {
		return err
	}
	tag := strings.TrimSpace(spec.Version)
	if tag == "" {
		return fmt.Errorf("agent %q has no pinned version in agents.json", agentIDValue)
	}
	spec.Bin = agentBinaryName(spec.Bin, currentPlatform)

	distDir := filepath.Join(vendorDir, "dist", agentIDValue)
	if strings.TrimSpace(*targetPlatform) != "" {
		distDir = filepath.Join(vendorDir, "dist", currentPlatform.String(), agentIDValue)
	}
	if strings.TrimSpace(spec.Distribution) == "npm-bundle" {
		if agentIDValue != "codex" {
			return fmt.Errorf("npm-bundle distribution is only supported for codex")
		}
		bundlePlatform, err := codexNPMBundlePlatform(currentPlatform, spec.CodexVersion)
		if err != nil {
			return err
		}
		expected := agentManifest{
			ID:           agentIDValue,
			Bin:          spec.Bin,
			Args:         spec.Args,
			Version:      tag,
			CodexBin:     bundlePlatform.CodexBin,
			CodexVersion: strings.TrimSpace(spec.CodexVersion),
		}
		return prepareCodexNPMBundle(spec, bundlePlatform, expected, distDir)
	}

	asset, err := releaseAssetName(agentIDValue, tag, currentPlatform)
	if err != nil {
		return err
	}
	if err := prepareAgent(agentIDValue, spec, tag, asset, distDir); err != nil {
		return err
	}
	return nil
}

func prepareCodexNPMBundle(spec agentSpec, bundlePlatform codexBundlePlatform, expected agentManifest, distDir string) error {
	if cached, err := hasPreparedAgent(distDir, expected); err != nil {
		return err
	} else if cached {
		fmt.Printf("Using cached codex@%s with Codex %s in %s\n", expected.Version, expected.CodexVersion, distDir)
		return nil
	}

	packageName := strings.TrimSpace(spec.Package)
	codexPackage := strings.TrimSpace(spec.CodexPackage)
	bunVersion := strings.TrimSpace(spec.BunVersion)
	if packageName == "" || codexPackage == "" || bunVersion == "" {
		return fmt.Errorf("codex npm bundle requires package, codexPackage, and bunVersion")
	}

	tmpDir, err := os.MkdirTemp("", "mediago-codex-agent-*")
	if err != nil {
		return fmt.Errorf("creating Codex agent temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	client := &http.Client{Timeout: 10 * time.Minute}
	adapterTarball, err := npmPackageTarballURL(client, npmRegistryURL, packageName, strings.TrimPrefix(expected.Version, "v"))
	if err != nil {
		return err
	}
	codexTarball, err := npmPackageTarballURL(client, npmRegistryURL, codexPackage, bundlePlatform.CodexPackageVersion)
	if err != nil {
		return err
	}

	adapterArchive := filepath.Join(tmpDir, "adapter.tgz")
	codexArchive := filepath.Join(tmpDir, "codex.tgz")
	fmt.Printf("Downloading %s@%s\n", packageName, expected.Version)
	if err := downloadURL(client, adapterTarball, adapterArchive); err != nil {
		return err
	}
	fmt.Printf("Downloading %s@%s\n", codexPackage, bundlePlatform.CodexPackageVersion)
	if err := downloadURL(client, codexTarball, codexArchive); err != nil {
		return err
	}

	adapterExtract := filepath.Join(tmpDir, "adapter")
	codexExtract := filepath.Join(tmpDir, "codex")
	if err := extractArchive(adapterArchive, adapterExtract); err != nil {
		return err
	}
	if err := extractArchive(codexArchive, codexExtract); err != nil {
		return err
	}
	adapterEntry := filepath.Join(adapterExtract, "package", "dist", "index.js")
	if info, statErr := os.Stat(adapterEntry); statErr != nil || info.IsDir() {
		if statErr == nil {
			statErr = fmt.Errorf("entry is a directory")
		}
		return fmt.Errorf("locating Codex ACP npm entry %s: %w", adapterEntry, statErr)
	}
	codexVendorSource := filepath.Join(codexExtract, "package", "vendor", bundlePlatform.CodexTarget)
	if info, statErr := os.Stat(codexVendorSource); statErr != nil || !info.IsDir() {
		if statErr == nil {
			statErr = fmt.Errorf("vendor target is not a directory")
		}
		return fmt.Errorf("locating Codex npm vendor target %s: %w", codexVendorSource, statErr)
	}

	if err := os.MkdirAll(filepath.Dir(distDir), 0o755); err != nil {
		return fmt.Errorf("creating agent dist parent: %w", err)
	}
	stagingDir, err := os.MkdirTemp(filepath.Dir(distDir), ".codex-stage-*")
	if err != nil {
		return fmt.Errorf("creating Codex staging dir: %w", err)
	}
	defer os.RemoveAll(stagingDir)

	adapterOutput := filepath.Join(stagingDir, expected.Bin)
	if err := compileCodexACPWithBun(adapterEntry, adapterOutput, bunVersion, bundlePlatform.BunTarget); err != nil {
		return err
	}
	codexVendorDest := filepath.Join(stagingDir, "codex", "vendor", bundlePlatform.CodexTarget)
	if err := copyDirectory(codexVendorSource, codexVendorDest); err != nil {
		return fmt.Errorf("installing Codex vendor target: %w", err)
	}
	if err := writeManifest(stagingDir, expected); err != nil {
		return err
	}
	if err := ensureExecutable(adapterOutput); err != nil {
		return fmt.Errorf("validating compiled Codex ACP: %w", err)
	}
	if err := ensureExecutable(filepath.Join(stagingDir, expected.CodexBin)); err != nil {
		return fmt.Errorf("validating packaged Codex: %w", err)
	}

	if err := os.RemoveAll(distDir); err != nil {
		return fmt.Errorf("cleaning %s: %w", distDir, err)
	}
	if err := os.Rename(stagingDir, distDir); err != nil {
		return fmt.Errorf("installing prepared Codex agent: %w", err)
	}
	fmt.Printf("Prepared codex@%s with Codex %s in %s\n", expected.Version, expected.CodexVersion, distDir)
	return nil
}

func compileCodexACPWithBun(entry string, output string, bunVersion string, target string) error {
	npx, err := exec.LookPath("npx")
	if err != nil {
		return fmt.Errorf("finding npx for pinned Bun build: %w", err)
	}
	command := exec.Command(
		npx,
		"--yes",
		"bun@"+strings.TrimSpace(bunVersion),
		"build",
		entry,
		"--compile",
		"--target="+strings.TrimSpace(target),
		"--outfile="+output,
	)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("compiling Codex ACP with Bun %s for %s: %w", bunVersion, target, err)
	}
	if err := os.Chmod(output, 0o755); err != nil && !errors.Is(err, os.ErrPermission) {
		return fmt.Errorf("marking compiled Codex ACP executable: %w", err)
	}
	return nil
}

type npmPackageVersionMetadata struct {
	Dist struct {
		Tarball string `json:"tarball"`
	} `json:"dist"`
}

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

func releaseAssetName(agentID string, tag string, detected platform) (string, error) {
	switch agentID {
	case "codex":
		target, err := codexTarget(detected)
		if err != nil {
			return "", err
		}
		version := strings.TrimPrefix(tag, "v")
		extension := "tar.gz"
		if detected.OS == "windows" {
			extension = "zip"
		}
		return fmt.Sprintf("codex-acp-%s-%s.%s", version, target, extension), nil
	case "opencode":
		return opencodeAsset(detected)
	default:
		return "", fmt.Errorf("unsupported agent %q", agentID)
	}
}

func codexTarget(detected platform) (string, error) {
	switch detected {
	case platform{OS: "darwin", Arch: "arm64"}:
		return "aarch64-apple-darwin", nil
	case platform{OS: "darwin", Arch: "x64"}:
		return "x86_64-apple-darwin", nil
	case platform{OS: "linux", Arch: "arm64"}:
		return "aarch64-unknown-linux-gnu", nil
	case platform{OS: "linux", Arch: "x64"}:
		return "x86_64-unknown-linux-gnu", nil
	case platform{OS: "windows", Arch: "arm64"}:
		return "aarch64-pc-windows-msvc", nil
	case platform{OS: "windows", Arch: "x64"}:
		return "x86_64-pc-windows-msvc", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", detected.OS, detected.Arch)
	}
}

func codexNPMBundlePlatform(detected platform, codexVersion string) (codexBundlePlatform, error) {
	codexVersion = strings.TrimSpace(codexVersion)
	if codexVersion == "" {
		return codexBundlePlatform{}, fmt.Errorf("Codex npm version is empty")
	}

	var result codexBundlePlatform
	var packagePlatform string
	var codexBinary string
	switch detected {
	case platform{OS: "darwin", Arch: "arm64"}:
		result.BunTarget = "bun-darwin-arm64"
		result.CodexTarget = "aarch64-apple-darwin"
		packagePlatform = "darwin-arm64"
		codexBinary = "codex"
	case platform{OS: "darwin", Arch: "x64"}:
		result.BunTarget = "bun-darwin-x64-baseline"
		result.CodexTarget = "x86_64-apple-darwin"
		packagePlatform = "darwin-x64"
		codexBinary = "codex"
	case platform{OS: "linux", Arch: "arm64"}:
		result.BunTarget = "bun-linux-arm64"
		result.CodexTarget = "aarch64-unknown-linux-musl"
		packagePlatform = "linux-arm64"
		codexBinary = "codex"
	case platform{OS: "linux", Arch: "x64"}:
		result.BunTarget = "bun-linux-x64-baseline"
		result.CodexTarget = "x86_64-unknown-linux-musl"
		packagePlatform = "linux-x64"
		codexBinary = "codex"
	case platform{OS: "windows", Arch: "arm64"}:
		result.BunTarget = "bun-windows-arm64"
		result.CodexTarget = "aarch64-pc-windows-msvc"
		packagePlatform = "win32-arm64"
		codexBinary = "codex.exe"
	case platform{OS: "windows", Arch: "x64"}:
		result.BunTarget = "bun-windows-x64-baseline"
		result.CodexTarget = "x86_64-pc-windows-msvc"
		packagePlatform = "win32-x64"
		codexBinary = "codex.exe"
	default:
		return codexBundlePlatform{}, fmt.Errorf("unsupported platform: %s/%s", detected.OS, detected.Arch)
	}
	result.CodexPackageVersion = codexVersion + "-" + packagePlatform
	result.CodexBin = filepath.Join("codex", "vendor", result.CodexTarget, "bin", codexBinary)
	return result, nil
}

func opencodeAsset(detected platform) (string, error) {
	switch detected {
	case platform{OS: "darwin", Arch: "arm64"}:
		return "opencode-darwin-arm64.zip", nil
	case platform{OS: "darwin", Arch: "x64"}:
		return "opencode-darwin-x64.zip", nil
	case platform{OS: "linux", Arch: "arm64"}:
		return "opencode-linux-arm64.tar.gz", nil
	case platform{OS: "linux", Arch: "x64"}:
		return "opencode-linux-x64.tar.gz", nil
	case platform{OS: "windows", Arch: "arm64"}:
		return "opencode-windows-arm64.zip", nil
	case platform{OS: "windows", Arch: "x64"}:
		return "opencode-windows-x64.zip", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", detected.OS, detected.Arch)
	}
}

func prepareAgent(id string, spec agentSpec, tag string, asset string, distDir string) error {
	expected := agentManifest{
		ID:      id,
		Bin:     spec.Bin,
		Args:    spec.Args,
		Version: tag,
	}
	if cached, err := hasPreparedAgent(distDir, expected); err != nil {
		return err
	} else if cached {
		fmt.Printf("Using cached %s@%s in %s\n", id, tag, distDir)
		return nil
	}

	tmpDir, err := os.MkdirTemp("", "mediago-agent-*")
	if err != nil {
		return fmt.Errorf("creating temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	archivePath := filepath.Join(tmpDir, asset)
	extractDir := filepath.Join(tmpDir, "extract")

	fmt.Printf("Downloading %s@%s: %s\n", spec.Repo, tag, asset)
	if err := downloadReleaseAsset(spec.Repo, tag, asset, archivePath); err != nil {
		return err
	}
	if err := extractArchive(archivePath, extractDir); err != nil {
		return err
	}
	if err := os.RemoveAll(distDir); err != nil {
		return fmt.Errorf("cleaning %s: %w", distDir, err)
	}
	if err := os.MkdirAll(distDir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", distDir, err)
	}
	if err := installExtractedBinary(extractDir, spec.Bin, distDir); err != nil {
		return err
	}
	if err := writeManifest(distDir, expected); err != nil {
		return err
	}
	fmt.Printf("Prepared %s in %s\n", id, distDir)
	return nil
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

func downloadReleaseAsset(repo string, tag string, asset string, out string) error {
	sourceURL := fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", strings.TrimSpace(repo), tag, asset)
	client := &http.Client{Timeout: 10 * time.Minute}
	return downloadURL(client, sourceURL, out)
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

func installExtractedBinary(extractDir string, bin string, distDir string) error {
	bin = strings.TrimSpace(bin)
	if bin == "" {
		return fmt.Errorf("agent bin is empty")
	}

	var found string
	err := filepath.WalkDir(extractDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || entry.Name() != bin || found != "" {
			return nil
		}
		found = path
		return nil
	})
	if err != nil {
		return fmt.Errorf("scanning extracted archive: %w", err)
	}
	if found == "" {
		return fmt.Errorf("archive did not contain expected binary: %s", bin)
	}

	input, err := os.Open(found)
	if err != nil {
		return fmt.Errorf("opening extracted binary %s: %w", found, err)
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
