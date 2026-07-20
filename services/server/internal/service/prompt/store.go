package prompt

import (
	"context"
	"errors"
	"sync"

	"github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
)

type promptTemplateStore interface {
	Load(ctx context.Context) (map[string]prompttemplates.PromptTemplate, error)
	Get(ctx context.Context, id string) (prompttemplates.PromptTemplate, error)
}

var (
	promptTemplateStoreMu sync.RWMutex
	activePromptTemplate  promptTemplateStore
)

var errPromptTemplateStoreNotConfigured = errors.New("prompt template store is not configured")

type unconfiguredPromptTemplateStore struct{}

func (unconfiguredPromptTemplateStore) Load(context.Context) (map[string]prompttemplates.PromptTemplate, error) {
	return nil, errPromptTemplateStoreNotConfigured
}

func (unconfiguredPromptTemplateStore) Get(context.Context, string) (prompttemplates.PromptTemplate, error) {
	return prompttemplates.PromptTemplate{}, errPromptTemplateStoreNotConfigured
}

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
	return unconfiguredPromptTemplateStore{}
}
