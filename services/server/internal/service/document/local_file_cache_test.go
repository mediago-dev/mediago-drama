package document

import "testing"

func TestMarkdownFileCacheHitAndInvalidation(t *testing.T) {
	cache := newMarkdownFileCache()

	if _, ok := cache.get("root", "a.md", 10, 100); ok {
		t.Fatal("expected miss on empty cache")
	}

	cache.replace("root", map[string]cachedMarkdownFile{
		"a.md": {size: 10, modTime: 100, content: "hello"},
	})

	if content, ok := cache.get("root", "a.md", 10, 100); !ok || content != "hello" {
		t.Fatalf("expected cache hit with content, got (%q, %v)", content, ok)
	}
	if _, ok := cache.get("root", "a.md", 11, 100); ok {
		t.Fatal("expected miss when size changes")
	}
	if _, ok := cache.get("root", "a.md", 10, 101); ok {
		t.Fatal("expected miss when modTime changes")
	}
}

func TestMarkdownFileCacheReplaceEvictsStaleEntries(t *testing.T) {
	cache := newMarkdownFileCache()
	cache.replace("root", map[string]cachedMarkdownFile{
		"a.md": {size: 10, modTime: 100, content: "a"},
	})
	// A fresh scan no longer sees a.md, so it must be dropped.
	cache.replace("root", map[string]cachedMarkdownFile{
		"b.md": {size: 1, modTime: 1, content: "b"},
	})
	if _, ok := cache.get("root", "a.md", 10, 100); ok {
		t.Fatal("expected a.md to be evicted after replace")
	}
	if _, ok := cache.get("root", "b.md", 1, 1); !ok {
		t.Fatal("expected b.md to be present after replace")
	}

	cache.replace("root", nil)
	if _, ok := cache.get("root", "b.md", 1, 1); ok {
		t.Fatal("expected root to be cleared on empty replace")
	}
}

func TestMarkdownFileCacheNilSafe(t *testing.T) {
	var cache *markdownFileCache
	if _, ok := cache.get("root", "a.md", 1, 1); ok {
		t.Fatal("nil cache should always miss")
	}
	cache.replace("root", map[string]cachedMarkdownFile{"a.md": {}}) // must not panic
}
