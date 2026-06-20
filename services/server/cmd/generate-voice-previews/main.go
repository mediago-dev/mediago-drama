package main

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	coregeneration "github.com/mediago-dev/mediago-drama/packages/core/pkg/generation"
	"github.com/mediago-dev/mediago-drama/packages/core/pkg/generation/official"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
)

const (
	defaultPrompt       = "你好，这是音色试听。Hello, voice preview."
	defaultManifestPath = "configs/voice-previews/manifest.json"
	defaultOutputDir    = "configs/voice-previews/minimax"
)

type manifest struct {
	SchemaVersion int             `json:"schemaVersion"`
	Previews      []manifestEntry `json:"previews"`
}

type manifestEntry struct {
	RouteID  string `json:"routeId"`
	VoiceID  string `json:"voiceId"`
	Path     string `json:"path"`
	MIMEType string `json:"mimeType,omitempty"`
}

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("generate-voice-previews", flag.ContinueOnError)
	dbPath := flags.String("db", "", "settings/workspace SQLite path used to read the MiniMax API key")
	apiKeyName := flags.String("api-key-name", coregeneration.ProviderMiniMax, "api_keys.key_name to read when -api-key-env is not set")
	apiKeyEnv := flags.String("api-key-env", "MINIMAX_API_KEY", "environment variable containing a MiniMax API key")
	manifestPath := flags.String("manifest", defaultManifestPath, "voice preview manifest path")
	outputDir := flags.String("output-dir", defaultOutputDir, "directory for generated mp3 files")
	prompt := flags.String("prompt", defaultPrompt, "preview text")
	limit := flags.Int("limit", 0, "maximum number of voices to process; 0 means all")
	offset := flags.Int("offset", 0, "number of voices to skip before processing")
	onlyVoice := flags.String("only", "", "generate only one voice id")
	overwrite := flags.Bool("overwrite", false, "regenerate existing mp3 files")
	dryRun := flags.Bool("dry-run", false, "print planned work without calling MiniMax")
	delay := flags.Duration("delay", 5*time.Second, "delay between API calls")
	retries := flags.Int("retries", 5, "number of retries for one voice after provider errors")
	retryDelay := flags.Duration("retry-delay", 90*time.Second, "initial retry delay after provider errors")
	if err := flags.Parse(args); err != nil {
		return err
	}

	voices, err := builtInMiniMaxVoices()
	if err != nil {
		return err
	}
	if selected := strings.TrimSpace(*onlyVoice); selected != "" {
		filtered := voices[:0]
		for _, voice := range voices {
			if voice.Value == selected {
				filtered = append(filtered, voice)
			}
		}
		voices = filtered
	}
	if *offset > 0 && *offset < len(voices) {
		voices = voices[*offset:]
	} else if *offset >= len(voices) {
		voices = nil
	}
	if *limit > 0 && *limit < len(voices) {
		voices = voices[:*limit]
	}

	fmt.Printf("planned voices: %d\n", len(voices))
	if *dryRun {
		for _, voice := range voices {
			fmt.Printf("%s -> %s\n", voice.Value, previewRelativePath(voice.Value))
		}
		return nil
	}
	if len(voices) == 0 {
		return nil
	}

	apiKey, source, err := resolveMiniMaxAPIKey(*apiKeyEnv, *apiKeyName, *dbPath)
	if err != nil {
		return err
	}
	fmt.Printf("using MiniMax API key from %s\n", source)

	provider, err := official.NewProvider(official.Config{APIKey: apiKey})
	if err != nil {
		return err
	}
	entries, err := readManifest(*manifestPath)
	if err != nil {
		return err
	}
	route, ok := coregeneration.FindRoute(coregeneration.RouteOfficialMiniMaxSpeech28Turbo)
	if !ok {
		return errors.New("MiniMax speech turbo route is missing")
	}

	if err := os.MkdirAll(*outputDir, 0o755); err != nil {
		return fmt.Errorf("creating output directory: %w", err)
	}
	for index, voice := range voices {
		relativePath := previewRelativePath(voice.Value)
		outputPath := filepath.Join(*outputDir, filepath.Base(relativePath))
		if !*overwrite {
			if _, err := os.Stat(outputPath); err == nil {
				fmt.Printf("[%d/%d] skip existing %s\n", index+1, len(voices), voice.Value)
				entries = upsertManifest(entries, voice.Value, relativePath, "audio/mpeg")
				continue
			}
		}

		fmt.Printf("[%d/%d] generating %s\n", index+1, len(voices), voice.Value)
		response, err := generateVoiceWithRetries(ctx, provider, coregeneration.Request{
			Kind:    coregeneration.KindAudio,
			RouteID: route.ID,
			Model:   route.Model,
			Prompt:  *prompt,
			Params: map[string]any{
				string(coregeneration.ParamVoiceID):      voice.Value,
				string(coregeneration.ParamSpeed):        1,
				string(coregeneration.ParamVolume):       1,
				string(coregeneration.ParamPitch):        0,
				string(coregeneration.ParamOutputFormat): "mp3",
				string(coregeneration.ParamSampleRate):   32000,
				string(coregeneration.ParamBitrate):      128000,
			},
		}, voice.Value, *retries, *retryDelay)
		if err != nil {
			return fmt.Errorf("generating %s: %w", voice.Value, err)
		}
		if len(response.Assets) == 0 || strings.TrimSpace(response.Assets[0].Base64) == "" {
			return fmt.Errorf("generating %s: provider returned no audio asset", voice.Value)
		}
		audio, err := base64.StdEncoding.DecodeString(response.Assets[0].Base64)
		if err != nil {
			return fmt.Errorf("decoding %s audio: %w", voice.Value, err)
		}
		if err := os.WriteFile(outputPath, audio, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", outputPath, err)
		}
		entries = upsertManifest(entries, voice.Value, relativePath, "audio/mpeg")
		if err := writeManifest(*manifestPath, entries); err != nil {
			return err
		}
		if index < len(voices)-1 && *delay > 0 {
			time.Sleep(*delay)
		}
	}

	return writeManifest(*manifestPath, entries)
}

func generateVoiceWithRetries(
	ctx context.Context,
	provider *official.Provider,
	request coregeneration.Request,
	voiceID string,
	retries int,
	retryDelay time.Duration,
) (coregeneration.Response, error) {
	var lastErr error
	for attempt := 0; attempt <= retries; attempt++ {
		response, err := provider.Generate(ctx, request)
		if err == nil {
			return response, nil
		}
		lastErr = err
		if attempt == retries {
			break
		}
		wait := retryDelay * time.Duration(attempt+1)
		fmt.Printf("  retry %d/%d for %s after %s: %v\n", attempt+1, retries, voiceID, wait, err)
		select {
		case <-ctx.Done():
			return coregeneration.Response{}, ctx.Err()
		case <-time.After(wait):
		}
	}
	return coregeneration.Response{}, lastErr
}

func builtInMiniMaxVoices() ([]coregeneration.ParamOption, error) {
	route, ok := coregeneration.FindRoute(coregeneration.RouteOfficialMiniMaxSpeech28Turbo)
	if !ok {
		return nil, errors.New("MiniMax speech turbo route is missing")
	}
	for _, param := range route.Params {
		if param.Name == string(coregeneration.ParamVoiceID) {
			voices := make([]coregeneration.ParamOption, len(param.Options))
			copy(voices, param.Options)
			return voices, nil
		}
	}
	return nil, errors.New("MiniMax speech route has no voiceId options")
}

func resolveMiniMaxAPIKey(envName string, keyName string, dbPath string) (string, string, error) {
	if envName = strings.TrimSpace(envName); envName != "" {
		if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
			return value, "env:" + envName, nil
		}
	}
	if dbPath = strings.TrimSpace(dbPath); dbPath == "" {
		return "", "", fmt.Errorf("MiniMax API key not found; set %s or pass -db", envName)
	}
	store := repository.NewAPIKeyStore(dbPath)
	value, source, err := store.Get(strings.TrimSpace(keyName))
	if err != nil {
		return "", "", err
	}
	if value == "" {
		return "", "", fmt.Errorf("MiniMax API key %q not found in %s", keyName, dbPath)
	}
	return value, "db:" + source + ":" + keyName, nil
}

var slugPattern = regexp.MustCompile(`[^a-z0-9._-]+`)

func previewRelativePath(voiceID string) string {
	clean := strings.ToLower(strings.TrimSpace(voiceID))
	clean = slugPattern.ReplaceAllString(clean, "-")
	clean = strings.Trim(clean, "-._")
	if clean == "" {
		clean = "voice"
	}
	if len(clean) > 64 {
		clean = clean[:64]
		clean = strings.Trim(clean, "-._")
	}
	sum := sha1.Sum([]byte(voiceID))
	return "minimax/" + clean + "-" + hex.EncodeToString(sum[:])[:10] + ".mp3"
}

func readManifest(path string) ([]manifestEntry, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}
	var current manifest
	if err := json.Unmarshal(data, &current); err != nil {
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}
	return current.Previews, nil
}

func upsertManifest(entries []manifestEntry, voiceID string, relativePath string, mimeType string) []manifestEntry {
	for _, routeID := range []string{
		coregeneration.RouteOfficialMiniMaxSpeech28HD,
		coregeneration.RouteOfficialMiniMaxSpeech28Turbo,
	} {
		found := false
		for index := range entries {
			if entries[index].RouteID == routeID && entries[index].VoiceID == voiceID {
				entries[index].Path = relativePath
				entries[index].MIMEType = mimeType
				found = true
			}
		}
		if !found {
			entries = append(entries, manifestEntry{
				RouteID:  routeID,
				VoiceID:  voiceID,
				Path:     relativePath,
				MIMEType: mimeType,
			})
		}
	}
	sort.Slice(entries, func(left int, right int) bool {
		if entries[left].RouteID == entries[right].RouteID {
			return entries[left].VoiceID < entries[right].VoiceID
		}
		return entries[left].RouteID < entries[right].RouteID
	})
	return entries
}

func writeManifest(path string, entries []manifestEntry) error {
	output := manifest{SchemaVersion: 1, Previews: entries}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling manifest: %w", err)
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating manifest directory: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("writing manifest: %w", err)
	}
	return nil
}
