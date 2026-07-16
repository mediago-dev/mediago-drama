package app

import (
	"testing"

	"github.com/gin-gonic/gin"
	servicegeneration "github.com/mediago-dev/mediago-drama/services/server/internal/service/generation"
)

type editionTestExtension struct {
	edition string
}

func (extension editionTestExtension) RuntimeEdition() string {
	return extension.edition
}

func (editionTestExtension) ContentUseAuthorizer() servicegeneration.ContentUseAuthorizer {
	return nil
}

func (editionTestExtension) RegisterRoutes(*gin.Engine, RuntimeExtensionServices) {}

func (editionTestExtension) Close() error {
	return nil
}

func TestRuntimeEdition(t *testing.T) {
	tests := []struct {
		name       string
		extensions []RuntimeExtension
		want       string
	}{
		{name: "community without extensions", want: "community"},
		{
			name:       "uses extension edition",
			extensions: []RuntimeExtension{editionTestExtension{edition: " Commercial "}},
			want:       "commercial",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := runtimeEdition(test.extensions); got != test.want {
				t.Fatalf("runtimeEdition() = %q, want %q", got, test.want)
			}
		})
	}
}
