package prompt

import (
	"context"
	"sync"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
)

type promptTemplateStore interface {
	Load(ctx context.Context) (map[string]prompttemplates.PromptTemplate, error)
	Get(ctx context.Context, id string) (prompttemplates.PromptTemplate, error)
}

var (
	promptTemplateStoreMu    sync.RWMutex
	activePromptTemplate     promptTemplateStore
	activePromptTemplateOnce sync.Once
)

// SetPromptTemplateStore sets the instruction template store used by runtime prompt rendering.
func SetPromptTemplateStore(store promptTemplateStore) {
	if store == nil {
		return
	}
	promptTemplateStoreMu.Lock()
	defer promptTemplateStoreMu.Unlock()
	activePromptTemplate = store
}

func currentPromptTemplateStore() promptTemplateStore {
	promptTemplateStoreMu.RLock()
	store := activePromptTemplate
	promptTemplateStoreMu.RUnlock()
	if store != nil {
		return store
	}
	activePromptTemplateOnce.Do(func() {
		promptTemplateStoreMu.Lock()
		defer promptTemplateStoreMu.Unlock()
		if activePromptTemplate == nil {
			activePromptTemplate = prompttemplates.NewService()
		}
	})
	promptTemplateStoreMu.RLock()
	defer promptTemplateStoreMu.RUnlock()
	return activePromptTemplate
}
