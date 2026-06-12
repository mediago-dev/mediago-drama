package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
)

// ProjectConfigStore persists project.media.json state.
type ProjectConfigStore interface {
	LoadProjectConfig(projectID string) (mediamcp.ProjectConfig, error)
	SaveProjectConfigPatchInput(projectID string, input mediamcp.ProjectConfigPatchInput) (service.ProjectConfigMutationResult, error)
}

// ProjectConfigs handles project.media.json HTTP routes.
type ProjectConfigs struct {
	store ProjectConfigStore
}

// NewProjectConfigs returns a project config route handler.
func NewProjectConfigs(store ProjectConfigStore) ProjectConfigs {
	return ProjectConfigs{store: store}
}

// HandleGetProjectConfig returns project.media.json.
func (handler ProjectConfigs) HandleGetProjectConfig(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	config, err := handler.store.LoadProjectConfig(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, config)
}

// HandlePatchProjectConfig updates project.media.json.
func (handler ProjectConfigs) HandlePatchProjectConfig(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[mediamcp.ProjectConfigPatchInput](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	result, err := handler.store.SaveProjectConfigPatchInput(projectID, payload)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, result)
}
