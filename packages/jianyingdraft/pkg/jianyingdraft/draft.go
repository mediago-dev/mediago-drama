package jianyingdraft

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ErrDraftAlreadyExists indicates that the destination draft directory exists.
var ErrDraftAlreadyExists = errors.New("draft already exists")

// Draft is an in-memory video-only Jianying draft.
type Draft struct {
	options DraftOptions
	reader  MetadataReader
	shots   []normalizedShot
}

// NewDraft creates an empty draft with the supplied options.
func NewDraft(options DraftOptions) *Draft {
	reader := options.MetadataReader
	if reader == nil {
		reader = FFProbeReader{}
	}
	return &Draft{options: options, reader: reader}
}

// AddShots appends shots using context.Background.
func (draft *Draft) AddShots(shots []Shot) error {
	return draft.AddShotsContext(context.Background(), shots)
}

// AddShotsContext appends validated local video shots in input order.
func (draft *Draft) AddShotsContext(ctx context.Context, shots []Shot) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if draft == nil {
		return errors.New("draft is nil")
	}
	if err := draft.validateOptions(); err != nil {
		return err
	}
	if draft.reader == nil {
		draft.reader = FFProbeReader{}
	}

	normalized := make([]normalizedShot, 0, len(shots))
	for index, shot := range shots {
		cleanPath := strings.TrimSpace(shot.Path)
		shotNumber := index + 1
		if cleanPath == "" {
			return fmt.Errorf("shot %d path is required", shotNumber)
		}
		absolutePath, err := filepath.Abs(cleanPath)
		if err != nil {
			return fmt.Errorf("resolving shot %d path: %w", shotNumber, err)
		}
		info, err := os.Stat(absolutePath)
		if err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("shot %d path does not exist: %s", shotNumber, absolutePath)
			}
			return fmt.Errorf("stat shot %d path %s: %w", shotNumber, absolutePath, err)
		}
		if info.IsDir() {
			return fmt.Errorf("shot %d path is a directory: %s", shotNumber, absolutePath)
		}

		metadata, err := draft.reader.Probe(ctx, absolutePath)
		if err != nil {
			return fmt.Errorf("probing shot %d metadata: %w", shotNumber, err)
		}
		if err := validateMetadata(metadata); err != nil {
			return fmt.Errorf("shot %d metadata is invalid: %w", shotNumber, err)
		}
		if shot.In < 0 {
			return fmt.Errorf("shot %d in must be >= 0", shotNumber)
		}
		duration := shot.Duration
		if duration == 0 {
			duration = metadata.Duration - shot.In
		}
		if duration <= 0 {
			return fmt.Errorf("shot %d duration must be > 0", shotNumber)
		}
		if shot.In > metadata.Duration || duration > metadata.Duration-shot.In {
			return fmt.Errorf(
				"shot %d trim range exceeds source duration: in=%d duration=%d source=%d",
				shotNumber,
				shot.In,
				duration,
				metadata.Duration,
			)
		}

		normalized = append(normalized, normalizedShot{
			duration: duration,
			in:       shot.In,
			path:     absolutePath,
			metadata: metadata,
		})
	}

	draft.shots = append(draft.shots, normalized...)
	return nil
}

// Export writes the draft files using context.Background.
func (draft *Draft) Export(draftsRoot string, options ExportOptions) error {
	_, err := draft.ExportContext(context.Background(), draftsRoot, options)
	return err
}

// ExportContext writes draft_content.json and draft_meta_info.json.
func (draft *Draft) ExportContext(ctx context.Context, draftsRoot string, options ExportOptions) (ExportResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if draft == nil {
		return ExportResult{}, errors.New("draft is nil")
	}
	if err := draft.validateOptions(); err != nil {
		return ExportResult{}, err
	}
	if len(draft.shots) == 0 {
		return ExportResult{}, errors.New("at least one shot is required")
	}

	root := strings.TrimSpace(draftsRoot)
	if root == "" {
		return ExportResult{}, errors.New("drafts root is required")
	}
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return ExportResult{}, fmt.Errorf("resolving drafts root: %w", err)
	}
	if err := os.MkdirAll(absoluteRoot, 0o755); err != nil {
		return ExportResult{}, fmt.Errorf("creating drafts root: %w", err)
	}

	draftPath := filepath.Join(absoluteRoot, draft.name())
	if _, err := os.Stat(draftPath); err == nil && !options.ReplaceExisting {
		return ExportResult{}, fmt.Errorf("%w: %s", ErrDraftAlreadyExists, draftPath)
	} else if err != nil && !os.IsNotExist(err) {
		return ExportResult{}, fmt.Errorf("checking draft path: %w", err)
	}

	tempPath := filepath.Join(absoluteRoot, "."+draft.name()+".tmp-"+randomSuffix())
	if err := os.RemoveAll(tempPath); err != nil {
		return ExportResult{}, fmt.Errorf("preparing temp draft directory: %w", err)
	}
	if err := os.MkdirAll(tempPath, 0o755); err != nil {
		return ExportResult{}, fmt.Errorf("creating draft directory: %w", err)
	}
	cleanupTemp := true
	defer func() {
		if cleanupTemp {
			_ = os.RemoveAll(tempPath)
		}
	}()

	mediaPaths, err := draft.prepareMedia(ctx, tempPath, draftPath, options)
	if err != nil {
		return ExportResult{}, err
	}
	contentJSON, duration, err := draft.buildContentJSON(mediaPaths)
	if err != nil {
		return ExportResult{}, err
	}
	metaJSON, err := draft.buildMetaJSON(draftPath, absoluteRoot, duration)
	if err != nil {
		return ExportResult{}, err
	}
	contentPath := filepath.Join(tempPath, "draft_content.json")
	metaPath := filepath.Join(tempPath, "draft_meta_info.json")
	if err := os.WriteFile(contentPath, contentJSON, 0o644); err != nil {
		return ExportResult{}, fmt.Errorf("writing draft_content.json: %w", err)
	}
	if err := os.WriteFile(metaPath, metaJSON, 0o644); err != nil {
		return ExportResult{}, fmt.Errorf("writing draft_meta_info.json: %w", err)
	}
	if options.ReplaceExisting {
		if err := os.RemoveAll(draftPath); err != nil {
			return ExportResult{}, fmt.Errorf("removing existing draft: %w", err)
		}
	}
	if err := os.Rename(tempPath, draftPath); err != nil {
		return ExportResult{}, fmt.Errorf("finalizing draft directory: %w", err)
	}
	cleanupTemp = false

	return ExportResult{
		DraftPath:      draftPath,
		ContentPath:    filepath.Join(draftPath, "draft_content.json"),
		MetaPath:       filepath.Join(draftPath, "draft_meta_info.json"),
		DurationMicros: duration,
		ShotCount:      len(draft.shots),
	}, nil
}

func (draft *Draft) validateOptions() error {
	if draft == nil {
		return errors.New("draft is nil")
	}
	name := draft.name()
	if name == "" {
		return errors.New("draft name is required")
	}
	if name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("draft name must not contain path separators: %s", name)
	}
	if draft.options.Width <= 0 {
		return errors.New("draft width must be > 0")
	}
	if draft.options.Height <= 0 {
		return errors.New("draft height must be > 0")
	}
	if draft.options.FPS <= 0 {
		return errors.New("draft fps must be > 0")
	}
	return nil
}

func (draft *Draft) name() string {
	if draft == nil {
		return ""
	}
	return strings.TrimSpace(draft.options.Name)
}

func validateMetadata(metadata VideoMetadata) error {
	if metadata.Duration <= 0 {
		return errors.New("duration must be > 0")
	}
	if metadata.Width <= 0 {
		return errors.New("width must be > 0")
	}
	if metadata.Height <= 0 {
		return errors.New("height must be > 0")
	}
	return nil
}

func (draft *Draft) duration() int64 {
	var duration int64
	for _, shot := range draft.shots {
		duration += shot.duration
	}
	return duration
}

func (draft *Draft) prepareMedia(ctx context.Context, tempDraftPath string, finalDraftPath string, options ExportOptions) (map[string]string, error) {
	if !options.CopyMedia {
		return nil, nil
	}
	materialsDir := filepath.Join(tempDraftPath, "materials")
	if err := os.MkdirAll(materialsDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating materials directory: %w", err)
	}
	copied := map[string]string{}
	usedNames := map[string]struct{}{}
	for _, shot := range draft.shots {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, ok := copied[shot.path]; ok {
			continue
		}
		filename := uniqueFilename(filepath.Base(shot.path), usedNames)
		destination := filepath.Join(materialsDir, filename)
		if err := copyFile(shot.path, destination); err != nil {
			return nil, fmt.Errorf("copying media %s: %w", shot.path, err)
		}
		copied[shot.path] = filepath.Join(finalDraftPath, "materials", filename)
	}
	return copied, nil
}

func copyFile(source string, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = input.Close() }()

	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer func() { _ = output.Close() }()

	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	return output.Close()
}

func uniqueFilename(filename string, used map[string]struct{}) string {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		filename = "shot.mp4"
	}
	stem := strings.TrimSuffix(filename, filepath.Ext(filename))
	extension := filepath.Ext(filename)
	for index := 0; ; index++ {
		candidate := filename
		if index > 0 {
			candidate = fmt.Sprintf("%s-%d%s", stem, index+1, extension)
		}
		if _, ok := used[candidate]; ok {
			continue
		}
		used[candidate] = struct{}{}
		return candidate
	}
}
