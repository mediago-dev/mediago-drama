package handlers

import (
	"errors"
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
	ListProjectsByStatus(status string) (mediamcp.ProjectList, error)
	CreateProject(id string, request service.CreateWorkspaceProjectRequest) (mediamcp.Project, error)
	DeleteProject(id string) (mediamcp.Project, bool, error)
	ArchiveProject(id string) (mediamcp.Project, bool, error)
	RestoreProject(id string) (mediamcp.Project, bool, error)
	PermanentlyDeleteProject(id string) (mediamcp.Project, bool, error)
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
	status := strings.TrimSpace(context.Query("status"))
	var (
		projects mediamcp.ProjectList
		err      error
	)
	if status == "" {
		projects, err = handler.store.ListProjects()
	} else {
		projects, err = handler.store.ListProjectsByStatus(status)
	}
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

// HandleDeleteProject moves a workspace project to the app trash.
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

// HandleArchiveProject archives a workspace project.
func (handler Projects) HandleArchiveProject(context *gin.Context) {
	projectID, ok := requiredPathParam(context, "projectId", "projectId")
	if !ok {
		return
	}
	project, archived, err := handler.store.ArchiveProject(projectID)
	if err != nil {
		handler.writeProjectLifecycleError(context, err)
		return
	}
	if !archived {
		httpresponse.Error(context, http.StatusNotFound, "项目不存在")
		return
	}
	httpresponse.OK(context, project)
}

// HandleRestoreProject restores an archived or trashed workspace project.
func (handler Projects) HandleRestoreProject(context *gin.Context) {
	projectID, ok := requiredPathParam(context, "projectId", "projectId")
	if !ok {
		return
	}
	project, restored, err := handler.store.RestoreProject(projectID)
	if err != nil {
		handler.writeProjectLifecycleError(context, err)
		return
	}
	if !restored {
		httpresponse.Error(context, http.StatusNotFound, "项目不存在")
		return
	}
	httpresponse.OK(context, project)
}

// HandlePermanentlyDeleteProject permanently deletes a trashed workspace project.
func (handler Projects) HandlePermanentlyDeleteProject(context *gin.Context) {
	projectID, ok := requiredPathParam(context, "projectId", "projectId")
	if !ok {
		return
	}
	project, deleted, err := handler.store.PermanentlyDeleteProject(projectID)
	if err != nil {
		handler.writeProjectLifecycleError(context, err)
		return
	}
	if !deleted {
		httpresponse.Error(context, http.StatusNotFound, "项目不存在")
		return
	}
	httpresponse.OK(context, project)
}

func (handler Projects) writeProjectLifecycleError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrProjectTrashOperationConflict):
		httpresponse.Error(context, http.StatusConflict, "项目已在垃圾箱中")
	case errors.Is(err, service.ErrProjectNotInTrash):
		httpresponse.Error(context, http.StatusConflict, "项目未在垃圾箱中")
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}

func (handler Projects) newProjectID() (string, error) {
	if handler.newID == nil {
		return "", nil
	}
	return handler.newID("project")
}
