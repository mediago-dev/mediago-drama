package handlers

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

// SPA serves embedded client-side rendered workspace assets.
type SPA struct {
	fileServer http.Handler
	staticFS   fs.FS
}

// NewSPA returns a SPA asset handler.
func NewSPA(staticFS fs.FS) SPA {
	return SPA{
		fileServer: http.FileServer(http.FS(staticFS)),
		staticFS:   staticFS,
	}
}

// Serve handles a non-API route through static files or index fallback.
func (handler SPA) Serve(context *gin.Context) {
	name := strings.TrimPrefix(path.Clean("/"+context.Request.URL.Path), "/")
	if name == "." || name == "" {
		handler.serveIndex(context)
		return
	}

	if exists(handler.staticFS, name) {
		handler.fileServer.ServeHTTP(context.Writer, context.Request)
		return
	}

	if path.Ext(name) != "" || strings.HasPrefix(name, "assets/") {
		http.NotFound(context.Writer, context.Request)
		return
	}

	handler.serveIndex(context)
}

func (handler SPA) serveIndex(context *gin.Context) {
	content, err := fs.ReadFile(handler.staticFS, "index.html")
	if err != nil {
		http.Error(context.Writer, "workspace index not found", http.StatusInternalServerError)
		return
	}

	context.Header("Content-Type", "text/html; charset=utf-8")
	context.Status(http.StatusOK)
	_, _ = context.Writer.Write(content)
}

func exists(staticFS fs.FS, name string) bool {
	info, err := fs.Stat(staticFS, name)
	return err == nil && !info.IsDir()
}
