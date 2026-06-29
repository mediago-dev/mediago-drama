package document

import "sync"

// cachedMarkdownFile is a previously read markdown file keyed by its on-disk stat.
type cachedMarkdownFile struct {
	size    int64
	modTime int64 // UnixNano
	content string
}

// markdownFileCache memoizes markdown file contents so unchanged files are not
// re-read from disk on every workspace scan. Entries are keyed by scan root and
// relative path, and invalidated when a file's size or modification time changes.
//
// It guards its own state with a dedicated mutex so it is safe to use regardless
// of whether the calling document Service holds a read or write lock.
type markdownFileCache struct {
	mu      sync.Mutex
	entries map[string]map[string]cachedMarkdownFile // scanRoot -> relativePath -> entry
}

func newMarkdownFileCache() *markdownFileCache {
	return &markdownFileCache{entries: map[string]map[string]cachedMarkdownFile{}}
}

// get returns the cached content for a file when its size and modification time
// still match the cached entry.
func (cache *markdownFileCache) get(root string, relative string, size int64, modTime int64) (string, bool) {
	if cache == nil {
		return "", false
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	entry, ok := cache.entries[root][relative]
	if !ok || entry.size != size || entry.modTime != modTime {
		return "", false
	}
	return entry.content, true
}

// replace swaps in the freshly observed entries for a scan root, dropping any
// stale entries for files that no longer exist.
func (cache *markdownFileCache) replace(root string, entries map[string]cachedMarkdownFile) {
	if cache == nil {
		return
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if len(entries) == 0 {
		delete(cache.entries, root)
		return
	}
	cache.entries[root] = entries
}
