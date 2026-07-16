package app

import (
	"strings"

	"github.com/gin-gonic/gin"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
	servicepromptpack "github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

// RuntimeExtension adds edition-specific behavior without placing it in the community build.
type RuntimeExtension interface {
	ContentUseAuthorizer() servicegeneration.ContentUseAuthorizer
	RegisterRoutes(*gin.Engine, RuntimeExtensionServices)
	Close() error
}

type runtimeEditionProvider interface {
	RuntimeEdition() string
}

func runtimeEdition(extensions []RuntimeExtension) string {
	for _, extension := range extensions {
		if extension == nil {
			continue
		}
		provider, ok := extension.(runtimeEditionProvider)
		if !ok {
			continue
		}
		if edition := strings.ToLower(strings.TrimSpace(provider.RuntimeEdition())); edition != "" {
			return edition
		}
	}
	return "community"
}

// RuntimeExtensionServices exposes the narrow local services required by an extension.
type RuntimeExtensionServices struct {
	PromptPacks  *servicepromptpack.Service
	WorkspaceDir string
}
