package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/torchstellar-team/mediago-drama/packages/server/internal/http/response"
	service "github.com/torchstellar-team/mediago-drama/packages/server/internal/service/document"
)

// ProjectBriefStore persists project brief state.
type ProjectBriefStore interface {
	LoadProjectBrief(projectID string) (service.ProjectBrief, error)
	SaveProjectBrief(projectID string, brief service.ProjectBrief, mask service.ProjectBriefUpdateMask) (service.ProjectBrief, error)
}

// ProjectBriefs handles project brief HTTP routes.
type ProjectBriefs struct {
	store   ProjectBriefStore
	publish func(projectID string, brief service.ProjectBrief)
}

// NewProjectBriefs returns a project brief route handler.
func NewProjectBriefs(store ProjectBriefStore, publish func(projectID string, brief service.ProjectBrief)) ProjectBriefs {
	return ProjectBriefs{store: store, publish: publish}
}

// HandleGetProjectBrief returns a project's creative brief.
func (handler ProjectBriefs) HandleGetProjectBrief(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	brief, err := handler.store.LoadProjectBrief(projectID)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, brief)
}

// HandlePutProjectBrief updates a project's creative brief.
func (handler ProjectBriefs) HandlePutProjectBrief(context *gin.Context) {
	projectID, ok := requiredProjectID(context)
	if !ok {
		return
	}
	payload, err := decodeJSON[service.ProjectBriefPatch](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	update, mask := service.ProjectBriefPatchToUpdate(payload)
	brief, err := handler.store.SaveProjectBrief(projectID, update, mask)
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	if !mask.Empty() && handler.publish != nil {
		handler.publish(projectID, brief)
	}
	httpresponse.OK(context, brief)
}
