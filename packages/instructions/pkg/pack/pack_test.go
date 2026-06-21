package pack

import (
	"archive/zip"
	"bytes"
	"context"
	"testing"
	"testing/fstest"
)

func TestParseFSParsesAllKinds(t *testing.T) {
	bundle, err := ParseFS(context.Background(), fstest.MapFS{
		"pack.json":              &fstest.MapFile{Data: []byte(`{"id":"sample","name":"Sample","version":"1.0.0","categories":[{"id":"extra","label":"Extra"}]}`)},
		"instructions/AGENTS.md": &fstest.MapFile{Data: []byte("---\nslug: AGENTS\ntitle: Agents\norder: 0\neditable: true\n---\nInstruction body\n")},
		"skills/writer.skill.md": &fstest.MapFile{Data: []byte("---\nname: writer\ndescription: Writes\nhint:\n  document_category: screenplay\n---\nSkill body\n")},
		"prompts/image.md":       &fstest.MapFile{Data: []byte("---\nid: image\nname: Image\ntype: image\ncategory: extra\n---\nPrompt body\n")},
	})
	if err != nil {
		t.Fatalf("ParseFS() error = %v", err)
	}
	if len(bundle.Entries) != 3 {
		t.Fatalf("entries = %d, want 3", len(bundle.Entries))
	}
	for _, entry := range bundle.Entries {
		if entry.ID == "" || entry.PackID != "sample" || entry.Body == "" {
			t.Fatalf("entry = %#v, want normalized IDs and body", entry)
		}
	}
}

func TestParseZipParsesPackArchive(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	writeZipFile(t, writer, "pack.json", `{"id":"sample","name":"Sample","version":"1.0.0"}`)
	writeZipFile(t, writer, "instructions/AGENTS.md", "---\nslug: AGENTS\ntitle: Agents\n---\nBody\n")
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
