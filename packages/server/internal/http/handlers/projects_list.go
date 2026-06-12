package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	mediamcp "github.com/mediago-dev/mediago-drama/packages/mcp/pkg/mcp"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/document"
)

// ProjectStore persists workspace project records.
type ProjectStore interface {
	ListProjects() (mediamcp.ProjectList, error)
	CreateProject(id string, request service.CreateWorkspaceProjectRequest) (mediamcp.Project, error)
	DeleteProject(id string) (mediamcp.Project, bool, error)
}

// Projects handles workspace project HTTP routes.
type Projects struct {
	store ProjectStore
	newID func(prefix string) (string, error)
}

// NewProjects returns a project route handler.
func NewProjects(store ProjectStore, newID func(prefix string) (string, error)) Projects {
	return Projects{store: store, newID: newID}
}

// HandleListProjects lists workspace projects.
func (handler Projects) HandleListProjects(context *gin.Context) {
	projects, err := handler.store.ListProjects()
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, projects)
}

// HandleCreateProject creates a workspace project.
func (handler Projects) HandleCreateProject(context *gin.Context) {
	payload, err := decodeJSON[service.CreateWorkspaceProjectRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	id, err := handler.newProjectID()
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	project, err := handler.store.CreateProject(id, payload)
	if err != nil {
		if strings.Contains(err.Error(), "projectDir") {
			httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
			return
		}
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, project)
}

// HandleDeleteProject deletes a workspace project.
func (handler Projects) HandleDeleteProject(context *gin.Context) {
	projectID, ok := requiredPathParam(context, "projectId", "projectId")
	if !ok {
		return
	}

	project, deleted, err := handler.store.DeleteProject(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "项目不存在")
		return
	}

	httpresponse.OK(context, project)
}

func (handler Projects) newProjectID() (string, error) {
	if handler.newID == nil {
		return "", nil
	}
	return handler.newID("project")
}
