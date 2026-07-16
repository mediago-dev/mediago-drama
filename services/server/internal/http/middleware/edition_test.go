package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestEdition(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
	}{
		{name: "defaults to community", want: "community"},
		{name: "normalizes commercial", value: " Commercial ", want: "commercial"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gin.SetMode(gin.ReleaseMode)
			router := gin.New()
			router.Use(Edition(test.value))
			router.GET("/health", func(context *gin.Context) {
				context.Status(http.StatusNoContent)
			})

			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
			if got := response.Header().Get(EditionHeader); got != test.want {
				t.Fatalf("%s = %q, want %q", EditionHeader, got, test.want)
			}
		})
	}
}
