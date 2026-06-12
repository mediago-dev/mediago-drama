package catalog

import "sync"

type Cache[T any] struct {
	once  sync.Once
	value T
}

func (cache *Cache[T]) Get(build func() T) T {
	cache.once.Do(func() {
		cache.value = build()
	})
	return cache.value
}
