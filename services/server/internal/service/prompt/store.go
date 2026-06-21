package prompt

import (
	"context"
	"sync"

	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

type promptPackStore interface {
	ListEntries(ctx context.Context, kind instructionpack.Kind) ([]promptpack.Entry, error)
	GetEntry(ctx context.Context, kind instructionpack.Kind, slug string) (promptpack.Entry, error)
}

var (
	promptPackStoreMu   sync.RWMutex
	activePackStore     promptPackStore
	activePackStoreOnce sync.Once
)

// SetPromptPackStore sets the prompt pack store used by runtime prompt rendering.
func SetPromptPackStore(store promptPackStore) {
	if store == nil {
		return
	}
	promptPackStoreMu.Lock()
	defer promptPackStoreMu.Unlock()
	activePackStore = store
}

func currentPackStore() promptPackStore {
	promptPackStoreMu.RLock()
	store := activePackStore
	promptPackStoreMu.RUnlock()
	if store != nil {
		return store
	}
	activePackStoreOnce.Do(func() {
		promptPackStoreMu.Lock()
		defer promptPackStoreMu.Unlock()
		if activePackStore == nil {
			activePackStore = promptpack.NewService()
		}
	})
	promptPackStoreMu.RLock()
	defer promptPackStoreMu.RUnlock()
	return activePackStore
}
