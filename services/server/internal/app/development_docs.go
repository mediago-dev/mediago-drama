//go:build !workspace_dist

package app

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"

	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

const openAPIPath = "/openapi.json"
const developmentDocsPath = "/docs"

func registerDevelopmentDocs(router *gin.Engine) {
	router.GET(openAPIPath, func(context *gin.Context) {
		body, err := os.ReadFile(developmentOpenAPIJSONPath())
		if err != nil {
			context.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "swagger document is not generated; run task -d services/server swagger",
			})
			return
		}
		context.Data(
			http.StatusOK,
			"application/json; charset=utf-8",
			body,
		)
	})
	router.GET(developmentDocsPath, func(context *gin.Context) {
		context.Redirect(http.StatusMovedPermanently, developmentDocsPath+"/index.html")
	})
	router.GET(
		developmentDocsPath+"/*any",
		ginSwagger.WrapHandler(
			swaggerFiles.NewHandler(),
			ginSwagger.URL(openAPIPath),
			ginSwagger.DefaultModelsExpandDepth(-1),
		),
	)
}

func developmentOpenAPIJSONPath() string {
	if path := os.Getenv("MEDIAGO_SWAGGER_JSON"); path != "" {
		return path
	}
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return filepath.Join(".cache", "server-swagger", "swagger.json")
	}
	return filepath.Clean(filepath.Join(
		filepath.Dir(filename),
		"..", "..", "..", "..",
		".cache", "server-swagger", "swagger.json",
	))
}
