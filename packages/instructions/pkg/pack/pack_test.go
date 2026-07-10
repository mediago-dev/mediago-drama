package pack

import (
	"archive/zip"
	"bytes"
	"context"
	"testing"
	"testing/fstest"
)

func TestParseFSParsesPackAssets(t *testing.T) {
	bundle, err := ParseFS(context.Background(), fstest.MapFS{
		"pack.json":              {Data: []byte(`{"id":"sample","name":"Sample","version":"1.0.0","categories":[{"id":"extra","label":"Extra"}]}`)},
		"skills/writer.skill.md": {Data: []byte("---\nname: writer\ndescription: Writes\ndocument_category: screenplay\ntemplate_id: screenplay.v1\n---\nSkill body\n")},
		"prompts/image.md":       {Data: []byte("---\nid: image\nname: Image\ntype: image\ncategory: extra\n---\nPrompt body\n")},
	})
	if err != nil {
		t.Fatalf("ParseFS() error = %v", err)
	}
	if len(bundle.Entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(bundle.Entries))
	}
	for _, entry := range bundle.Entries {
		if entry.ID == "" || entry.PackID != "sample" || entry.Body == "" {
			t.Fatalf("entry = %#v, want normalized IDs and body", entry)
		}
		if entry.Slug == "writer" {
			hint, ok := entry.Metadata["hint"].(map[string]string)
			if !ok || hint["document_category"] != "screenplay" {
				t.Fatalf("skill hint = %#v, want document_category", entry.Metadata["hint"])
			}
			if entry.Metadata["template_id"] != "screenplay.v1" {
				t.Fatalf("template_id = %#v, want screenplay.v1", entry.Metadata["template_id"])
			}
		}
	}
}

func TestParseFSRejectsInstructions(t *testing.T) {
	_, err := ParseFS(context.Background(), fstest.MapFS{
		"pack.json":              {Data: []byte(`{"id":"sample","name":"Sample","version":"1.0.0"}`)},
		"instructions/AGENTS.md": {Data: []byte("---\nslug: AGENTS\n---\nInstruction body\n")},
	})
	if err == nil {
		t.Fatal("ParseFS() error = nil, want invalid pack")
	}
}

func TestParseFSAcceptsLegacyNestedSkillDocumentCategory(t *testing.T) {
	bundle, err := ParseFS(context.Background(), fstest.MapFS{
		"pack.json":              &fstest.MapFile{Data: []byte(`{"id":"sample","name":"Sample","version":"1.0.0"}`)},
		"skills/writer.skill.md": &fstest.MapFile{Data: []byte("---\nname: writer\ndescription: Writes\nhint:\n  document_category: screenplay\n---\nSkill body\n")},
	})
	if err != nil {
		t.Fatalf("ParseFS() error = %v", err)
	}
	if len(bundle.Entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(bundle.Entries))
	}
	hint, ok := bundle.Entries[0].Metadata["hint"].(map[string]string)
	if !ok || hint["document_category"] != "screenplay" {
		t.Fatalf("skill hint = %#v, want document_category", bundle.Entries[0].Metadata["hint"])
	}
}

func TestParseFSAcceptsUnicodeSkillName(t *testing.T) {
	bundle, err := ParseFS(context.Background(), fstest.MapFS{
		"pack.json":           {Data: []byte(`{"id":"sample","name":"Sample","version":"1.0.0"}`)},
		"skills/产品图.skill.md": {Data: []byte("---\nname: 产品图\ndescription: 产品图生成指导\n---\nSkill body\n")},
	})
	if err != nil {
		t.Fatalf("ParseFS() error = %v", err)
	}
	if len(bundle.Entries) != 1 || bundle.Entries[0].Slug != "产品图" {
		t.Fatalf("entries = %#v, want Unicode skill name", bundle.Entries)
	}
}

func TestParseZipParsesPackArchive(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	writeZipFile(t, writer, "pack.json", `{"id":"sample","name":"Sample","version":"1.0.0"}`)
	writeZipFile(t, writer, "skills/writer.skill.md", "---\nname: writer\ndescription: Writes\n---\nBody\n")
	if err := writer.Close(); err != nil {
		t.Fatalf("closing zip: %v", err)
	}
	bundle, err := ParseZip(context.Background(), buffer.Bytes())
	if err != nil {
		t.Fatalf("ParseZip() error = %v", err)
	}
	if got := len(bundle.Entries); got != 1 {
		t.Fatalf("entries = %d, want 1", got)
	}
}

func TestParseFSAllowsDottedPackID(t *testing.T) {
	bundle, err := ParseFS(context.Background(), fstest.MapFS{
		"pack.json": &fstest.MapFile{Data: []byte(`{"id":"com.example.test","name":"Sample","version":"1.0.0"}`)},
	})
	if err != nil {
		t.Fatalf("ParseFS() error = %v", err)
	}
	if bundle.Manifest.ID != "com.example.test" {
		t.Fatalf("pack id = %q, want dotted id", bundle.Manifest.ID)
	}
}

func writeZipFile(t *testing.T, writer *zip.Writer, name string, body string) {
	t.Helper()
	file, err := writer.Create(name)
	if err != nil {
		t.Fatalf("creating zip file %s: %v", name, err)
	}
	if _, err := file.Write([]byte(body)); err != nil {
		t.Fatalf("writing zip file %s: %v", name, err)
	}
}
