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
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const defaultAgentID = "codex"

type agentSpec struct {
	Repo    string   `json:"repo"`
	Bin     string   `json:"bin"`
	Args    []string `json:"args"`
	Version string   `json:"version"`
}

type agentManifest struct {
	ID      string   `json:"id"`
	Bin     string   `json:"bin"`
	Args    []string `json:"args"`
	Version string   `json:"version"`
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
	asset, err := releaseAssetName(agentIDValue, tag, currentPlatform)
	if err != nil {
		return err
	}
	spec.Bin = agentBinaryName(spec.Bin, currentPlatform)

	distDir := filepath.Join(vendorDir, "dist", agentIDValue)
	if strings.TrimSpace(*targetPlatform) != "" {
		distDir = filepath.Join(vendorDir, "dist", currentPlatform.String(), agentIDValue)
	}
	if err := prepareAgent(agentIDValue, spec, tag, asset, distDir); err != nil {
		return err
	}
	return nil
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
		return fmt.Sprintf("codex-acp-%s-%s.tar.gz", version, target), nil
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
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", detected.OS, detected.Arch)
	}
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
	return true, nil
}

func manifestMatches(got agentManifest, want agentManifest) bool {
	if strings.TrimSpace(got.ID) != want.ID ||
		strings.TrimSpace(got.Bin) != want.Bin ||
		strings.TrimSpace(got.Version) != want.Version ||
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
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return fmt.Errorf("creating archive directory: %w", err)
	}

	url := fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", strings.TrimSpace(repo), tag, asset)
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
