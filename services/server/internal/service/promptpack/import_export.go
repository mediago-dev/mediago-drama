package promptpack

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack/codec"
	"github.com/mediago-dev/mediago-drama/services/server/internal/domain"
	"github.com/mediago-dev/mediago-drama/services/server/internal/repository"
	"gopkg.in/yaml.v3"
)

const (
	defaultExportPackID      = "mediago.default-prompts"
	defaultExportPackNameSfx = " Export"
	maxPromptPackUploadBytes = 32 << 20
)

// MaxUploadBytes returns the maximum accepted .mgpack upload size.
func MaxUploadBytes() int64 {
	return maxPromptPackUploadBytes
}

// ExportedPack is an encoded .mgpack payload ready for download.
type ExportedPack struct {
	FileName string
	Data     []byte
	Pack     Pack
}

// InstallProvenance binds decrypted pack content to a formal platform release.
type InstallProvenance struct {
	PackageID string
	ReleaseID string
	Version   string
}

// ExportPack encodes one installed prompt pack as a complete .mgpack file.
func (store *Service) ExportPack(ctx context.Context, packID string) (ExportedPack, error) {
	return store.ExportPackSnapshot(ctx, packID)
}

// ExportPackSnapshot encodes a pack for trusted in-process commercial wrapping.
// It is intentionally not exposed by the public HTTP API.
func (store *Service) ExportPackSnapshot(ctx context.Context, packID string) (ExportedPack, error) {
	return store.exportPackSnapshot(ctx, packID, "")
}

// ExportPackSnapshotAtVersion encodes a trusted in-process snapshot with an
// explicit release version while leaving the persisted authoring pack unchanged.
func (store *Service) ExportPackSnapshotAtVersion(ctx context.Context, packID string, version string) (ExportedPack, error) {
	version = strings.TrimSpace(version)
	if version == "" || len(version) > 64 {
		return ExportedPack{}, fmt.Errorf("%w: snapshot version is invalid", ErrInvalidPack)
	}
	return store.exportPackSnapshot(ctx, packID, version)
}

func (store *Service) exportPackSnapshot(ctx context.Context, packID string, version string) (ExportedPack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return ExportedPack{}, err
	}
	model, err := store.repo.GetPack(strings.TrimSpace(packID))
	if repository.IsRecordNotFound(err) {
		return ExportedPack{}, fmt.Errorf("%w: %s", ErrPackNotFound, strings.TrimSpace(packID))
	}
	if err != nil {
		return ExportedPack{}, err
	}
	pack := packFromModel(model)
	bundle, err := store.bundleFromStoredPack(ctx, model)
	if err != nil {
		return ExportedPack{}, err
	}
	if err := validateBundleForExport(bundle); err != nil {
		return ExportedPack{}, err
	}
	if version != "" {
		bundle.Manifest.Version = version
		pack.Version = version
	}
	bundle = importableExportBundle(bundle, pack)
	data, err := encodeBundle(bundle)
	if err != nil {
		return ExportedPack{}, err
	}
	return ExportedPack{
		FileName: readablePackFileName(bundle.Manifest.Name, bundle.Manifest.ID, bundle.Manifest.Version),
		Data:     data,
		Pack:     pack,
	}, nil
}

func validateBundleForExport(bundle instructionpack.Bundle) error {
	for _, packedEntry := range bundle.Entries {
		entry := Entry{
			Kind:        packedEntry.Kind,
			Slug:        packedEntry.Slug,
			Name:        packedEntry.Name,
			Title:       packedEntry.Title,
			Description: packedEntry.Description,
			Body:        packedEntry.Body,
		}
		if err := validateEntryForWrite(entry); err != nil {
			return fmt.Errorf("%w: %s %q is incomplete", ErrInvalidPack, packedEntry.Kind, packedEntry.Slug)
		}
		if packedEntry.Kind == instructionpack.KindSkill && strings.TrimSpace(packedEntry.Description) == "" {
			return fmt.Errorf("%w: skill %q description is required", ErrInvalidPack, packedEntry.Slug)
		}
	}
	return nil
}

// InstallData installs an uploaded v1 .mgpack payload. Unsupported container
// versions are delegated to the optional protected importer.
func (store *Service) InstallData(ctx context.Context, fileName string, data []byte) (Pack, error) {
	pack, err := store.installData(ctx, fileName, data, InstallProvenance{})
	if !errors.Is(err, ErrUnsupportedPackVersion) {
		return pack, err
	}
	if store.protectedImporter == nil {
		if store.protectedImportErr != nil {
			return Pack{}, fmt.Errorf("%w: %v", ErrProtectedPackUnavailable, store.protectedImportErr)
		}
		return pack, err
	}
	imported, importErr := store.protectedImporter.Import(ctx, fileName, data)
	if importErr != nil {
		return Pack{}, importErr
	}
	return store.InstallDataWithProvenance(ctx, fileName, imported.Payload, InstallProvenance{
		PackageID: imported.PackageID,
		ReleaseID: imported.ReleaseID,
		Version:   imported.Version,
	})
}

// InstallDataWithProvenance atomically imports decrypted content with its formal source.
func (store *Service) InstallDataWithProvenance(ctx context.Context, fileName string, data []byte, provenance InstallProvenance) (Pack, error) {
	provenance.PackageID = strings.TrimSpace(provenance.PackageID)
	provenance.ReleaseID = strings.TrimSpace(provenance.ReleaseID)
	provenance.Version = strings.TrimSpace(provenance.Version)
	if provenance.PackageID == "" || provenance.ReleaseID == "" || provenance.Version == "" {
		return Pack{}, fmt.Errorf("%w: formal provenance is incomplete", ErrInvalidPack)
	}
	return store.installData(ctx, fileName, data, provenance)
}

func (store *Service) installData(ctx context.Context, fileName string, data []byte, provenance InstallProvenance) (Pack, error) {
	if err := store.ensureSeeded(ctx); err != nil {
		return Pack{}, err
	}
	fileName = strings.TrimSpace(fileName)
	extension := strings.ToLower(filepath.Ext(fileName))
	if extension != ".mgpack" {
		return Pack{}, fmt.Errorf("%w: expected .mgpack file", ErrInvalidPack)
	}
	if len(data) == 0 {
		return Pack{}, fmt.Errorf("%w: file is empty", ErrInvalidPack)
	}
	if len(data) > maxPromptPackUploadBytes {
		return Pack{}, fmt.Errorf("%w: file is too large", ErrInvalidPack)
	}
	archive, err := codec.Decode(data)
	if errors.Is(err, codec.ErrUnsupportedVersion) {
		return Pack{}, fmt.Errorf("%w: %v", ErrUnsupportedPackVersion, err)
	}
	if err != nil {
		return Pack{}, fmt.Errorf("%w: decoding .mgpack: %v", ErrInvalidPack, err)
	}
	if provenance.PackageID == "" && !store.allowUnprotected {
		return Pack{}, ErrUnprotectedPackImportDenied
	}
	bundle, err := instructionpack.ParseZip(ctx, archive)
	if err != nil {
		return Pack{}, fmt.Errorf("%w: parsing .mgpack: %v", ErrInvalidPack, err)
	}
	if bundle.Manifest.ID == DefaultPackID {
		return Pack{}, fmt.Errorf("%w: default pack cannot be imported", ErrInvalidPack)
	}
	if provenance.PackageID != "" && provenance.PackageID != bundle.Manifest.ID {
		return Pack{}, fmt.Errorf("%w: formal package id mismatch", ErrInvalidPack)
	}
	if provenance.Version != "" && provenance.Version != bundle.Manifest.Version {
		bundle.Manifest.Version = provenance.Version
		data, err = encodeBundle(bundle)
		if err != nil {
			return Pack{}, fmt.Errorf("%w: applying formal release version: %w", ErrInvalidPack, err)
		}
	}

	origin, err := store.persistUploadedPack(bundle.Manifest, data, extension)
	if err != nil {
		return Pack{}, err
	}
	if err := store.installBundleWithProvenance(ctx, bundle, packSourceImported, origin, provenance); err != nil {
		return Pack{}, err
	}
	model, err := store.repo.GetPack(bundle.Manifest.ID)
	if err != nil {
		return Pack{}, err
	}
	return packFromModel(model), nil
}

func (store *Service) bundleFromStoredPack(ctx context.Context, pack domain.PackModel) (instructionpack.Bundle, error) {
	categories, err := store.repo.ListCategories()
	if err != nil {
		return instructionpack.Bundle{}, err
	}
	entries, err := store.repo.ListEntries()
	if err != nil {
		return instructionpack.Bundle{}, err
	}
	bundle := instructionpack.Bundle{
		Manifest: instructionpack.Manifest{
			ID:          pack.ID,
			Name:        pack.Name,
			Version:     pack.Version,
			Author:      pack.Author,
			Description: pack.Description,
		},
	}
	for _, category := range categories {
		if category.PackID != pack.ID {
			continue
		}
		bundle.Categories = append(bundle.Categories, instructionpack.Category{
			ID:    category.ID,
			Label: category.Label,
			Order: category.Order,
		})
	}
	for _, resolved := range resolvePackEntryModels(entries, pack.ID) {
		bundle.Entries = append(bundle.Entries, resolved.packEntry())
	}
	sort.SliceStable(bundle.Categories, func(first, second int) bool {
		if bundle.Categories[first].Order != bundle.Categories[second].Order {
			return bundle.Categories[first].Order < bundle.Categories[second].Order
		}
		return bundle.Categories[first].ID < bundle.Categories[second].ID
	})
	sort.SliceStable(bundle.Entries, func(first, second int) bool {
		if bundle.Entries[first].Kind != bundle.Entries[second].Kind {
			return bundle.Entries[first].Kind < bundle.Entries[second].Kind
		}
		return bundle.Entries[first].Slug < bundle.Entries[second].Slug
	})
	bundle.Manifest.Categories = append([]instructionpack.Category(nil), bundle.Categories...)
	if ctx == nil {
		return bundle, nil
	}
	return bundle, ctx.Err()
}

func importableExportBundle(bundle instructionpack.Bundle, pack Pack) instructionpack.Bundle {
	if pack.Source != packSourceDefault && bundle.Manifest.ID != DefaultPackID {
		return bundle
	}
	bundle.Manifest.ID = defaultExportPackID
	if !strings.HasSuffix(bundle.Manifest.Name, defaultExportPackNameSfx) {
		bundle.Manifest.Name = strings.TrimSpace(bundle.Manifest.Name + defaultExportPackNameSfx)
	}
	for index := range bundle.Entries {
		bundle.Entries[index].PackID = defaultExportPackID
		bundle.Entries[index].ID = instructionpack.EntryID(
			defaultExportPackID,
			bundle.Entries[index].Kind,
			bundle.Entries[index].Slug,
		)
	}
	return bundle
}

func (entry Entry) packEntry() instructionpack.Entry {
	return instructionpack.Entry{
		ID:          instructionpack.EntryID(entry.PackID, entry.Kind, entry.Slug),
		PackID:      entry.PackID,
		Kind:        entry.Kind,
		Slug:        entry.Slug,
		Name:        entry.Name,
		Title:       entry.Title,
		Description: entry.Description,
		Body:        entry.Body,
		Metadata:    snapshotMetadata(entry.Metadata),
	}
}

func snapshotMetadata(metadata map[string]any) map[string]any {
	result := cloneMetadata(metadata)
	delete(result, entryMetadataCopiedFrom)
	delete(result, entryMetadataCopiedFromPack)
	delete(result, entryMetadataLinked)
	return result
}

func encodeBundle(bundle instructionpack.Bundle) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	if err := addZipJSON(writer, "pack.json", bundle.Manifest); err != nil {
		return nil, err
	}
	for _, entry := range bundle.Entries {
		switch entry.Kind {
		case instructionpack.KindSkill:
			content, err := skillMarkdown(entry)
			if err != nil {
				return nil, err
			}
			if err := addZipText(writer, filepath.ToSlash(filepath.Join("skills", entry.Slug+".skill.md")), content); err != nil {
				return nil, err
			}
		case instructionpack.KindPrompt:
			content, err := promptMarkdown(entry)
			if err != nil {
				return nil, err
			}
			if err := addZipText(writer, filepath.ToSlash(filepath.Join("prompts", entry.Slug+".md")), content); err != nil {
				return nil, err
			}
		default:
			return nil, fmt.Errorf("%w: unsupported entry kind %q", ErrInvalidPack, entry.Kind)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("closing pack archive: %w", err)
	}
	if _, err := instructionpack.ParseZip(context.Background(), buffer.Bytes()); err != nil {
		return nil, err
	}
	return codec.Encode(buffer.Bytes()), nil
}

func addZipJSON(writer *zip.Writer, path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding %s: %w", path, err)
	}
	return addZipText(writer, path, string(data)+"\n")
}

func addZipText(writer *zip.Writer, path string, content string) error {
	header := &zip.FileHeader{Name: path, Method: zip.Deflate}
	header.SetMode(0o644)
	target, err := writer.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("creating %s: %w", path, err)
	}
	if _, err := io.WriteString(target, content); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}

type exportedSkillFrontmatter struct {
	Name             string            `yaml:"name"`
	Title            string            `yaml:"title,omitempty"`
	Description      string            `yaml:"description"`
	DocumentCategory string            `yaml:"document_category,omitempty"`
	TemplateID       string            `yaml:"template_id,omitempty"`
	Hint             map[string]string `yaml:"hint,omitempty"`
}

func skillMarkdown(entry instructionpack.Entry) (string, error) {
	if strings.TrimSpace(entry.Description) == "" {
		return "", fmt.Errorf("%w: skill %q description is required", ErrInvalidPack, entry.Slug)
	}
	hint, documentCategory := splitDocumentCategoryHint(metadataStringMap(entry.Metadata, "hint"))
	frontmatter, err := yaml.Marshal(exportedSkillFrontmatter{
		Name:             entry.Slug,
		Title:            entry.Title,
		Description:      entry.Description,
		DocumentCategory: documentCategory,
		TemplateID:       metadataString(entry.Metadata, "template_id"),
		Hint:             hint,
	})
	if err != nil {
		return "", fmt.Errorf("encoding skill %s frontmatter: %w", entry.Slug, err)
	}
	return "---\n" + strings.TrimSpace(string(frontmatter)) + "\n---\n" + normalizeBody(entry.Body), nil
}

type exportedPromptFrontmatter struct {
	ID       string `yaml:"id"`
	Name     string `yaml:"name"`
	Category string `yaml:"category,omitempty"`
	Type     string `yaml:"type,omitempty"`
}

func promptMarkdown(entry instructionpack.Entry) (string, error) {
	category := metadataString(entry.Metadata, "category")
	if category == "" {
		category = "extra"
	}
	frontmatter, err := yaml.Marshal(exportedPromptFrontmatter{
		ID:       entry.Slug,
		Name:     entry.Name,
		Category: category,
		Type:     metadataString(entry.Metadata, "type"),
	})
	if err != nil {
		return "", fmt.Errorf("encoding prompt %s frontmatter: %w", entry.Slug, err)
	}
	return "---\n" + strings.TrimSpace(string(frontmatter)) + "\n---\n" + normalizeBody(entry.Body), nil
}

func (store *Service) persistUploadedPack(manifest instructionpack.Manifest, data []byte, sourceExt string) (string, error) {
	dir := strings.TrimSpace(store.packFilesDir)
	if dir == "" {
		tempDir, err := os.MkdirTemp("", "mediago-prompt-packs-*")
		if err != nil {
			return "", fmt.Errorf("creating prompt pack temp directory: %w", err)
		}
		dir = tempDir
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("creating prompt pack directory: %w", err)
	}
	path := filepath.Join(dir, safePackFileName(manifest.ID, manifest.Version, sourceExt))
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("saving prompt pack file: %w", err)
	}
	return path, nil
}

func safePackFileName(packID string, version string, sourceExt string) string {
	extension := strings.ToLower(strings.TrimSpace(sourceExt))
	if extension != ".mgpack" {
		extension = ".mgpack"
	}
	base := sanitizeFilePart(packID)
	suffix := sanitizeFilePart(version)
	if suffix == "" {
		suffix = time.Now().UTC().Format("20060102150405")
	}
	return base + "-" + suffix + extension
}

func readablePackFileName(name string, packID string, version string) string {
	base := sanitizeReadableFilePart(name)
	if base == "" {
		base = sanitizeReadableFilePart(packID)
	}
	if base == "" {
		base = "prompt-pack"
	}
	version = strings.TrimSpace(version)
	version = strings.TrimPrefix(strings.TrimPrefix(version, "v"), "V")
	version = strings.ReplaceAll(sanitizeReadableFilePart(version), " ", "-")
	if version == "" {
		version = time.Now().UTC().Format("20060102150405")
	}
	return base + "-v" + version + ".mgpack"
}

func sanitizeReadableFilePart(value string) string {
	var builder strings.Builder
	for _, char := range strings.TrimSpace(value) {
		switch {
		case unicode.IsControl(char), strings.ContainsRune(`<>:"/\|?*`, char):
			builder.WriteByte('-')
		default:
			builder.WriteRune(char)
		}
	}
	result := strings.Join(strings.Fields(builder.String()), " ")
	for strings.Contains(result, "--") {
		result = strings.ReplaceAll(result, "--", "-")
	}
	result = strings.Trim(result, " .-_")
	runes := []rune(result)
	if len(runes) > 96 {
		result = strings.TrimRight(string(runes[:96]), " .-_")
	}
	return result
}

func sanitizeFilePart(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	var builder strings.Builder
	for _, char := range value {
		if char >= 'a' && char <= 'z' ||
			char >= '0' && char <= '9' ||
			char == '-' ||
			char == '_' ||
			char == '.' {
			builder.WriteRune(char)
			continue
		}
		builder.WriteByte('-')
	}
	result := strings.Trim(builder.String(), "-_.")
	result = strings.Join(strings.FieldsFunc(result, func(char rune) bool {
		return char == '-' || char == '_' || char == '.'
	}), "-")
	if result == "" {
		return "prompt-pack"
	}
	return result
}

func cloneMetadata(metadata map[string]any) map[string]any {
	if len(metadata) == 0 {
		return nil
	}
	result := make(map[string]any, len(metadata))
	for key, value := range metadata {
		result[key] = value
	}
	return result
}

func metadataString(metadata map[string]any, key string) string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func metadataStringMap(metadata map[string]any, key string) map[string]string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return nil
	}
	result := map[string]string{}
	switch typed := value.(type) {
	case map[string]string:
		for key, value := range typed {
			result[key] = value
		}
	case map[string]any:
		for key, value := range typed {
			if value != nil {
				result[key] = strings.TrimSpace(fmt.Sprint(value))
			}
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func splitDocumentCategoryHint(values map[string]string) (map[string]string, string) {
	if len(values) == 0 {
		return nil, ""
	}
	hint := make(map[string]string, len(values))
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		hint[key] = strings.TrimSpace(value)
	}
	documentCategory := strings.TrimSpace(hint["document_category"])
	delete(hint, "document_category")
	if len(hint) == 0 {
		return nil, documentCategory
	}
	return hint, documentCategory
}
