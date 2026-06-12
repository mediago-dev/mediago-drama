package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/packages/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/packages/server/internal/service/prompttemplates"
)

// PromptTemplateService supplies prompt template persistence.
type PromptTemplateService interface {
	Load(ctx context.Context) (map[string]service.PromptTemplate, error)
	Save(ctx context.Context, id string, template service.PromptTemplate) (service.PromptTemplate, error)
}

// PromptTemplates handles prompt template HTTP routes.
type PromptTemplates struct {
	store PromptTemplateService
}

// NewPromptTemplates returns a prompt template route handler.
func NewPromptTemplates(store PromptTemplateService) PromptTemplates {
	return PromptTemplates{store: store}
}

type promptTemplateListResponse struct {
	Templates []service.PromptTemplate `json:"templates"`
}

// HandleListPromptTemplates lists editable system prompt templates.
func (handler PromptTemplates) HandleListPromptTemplates(context *gin.Context) {
	templateMap, err := handler.store.Load(context.Request.Context())
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}

	httpresponse.OK(context, promptTemplateListResponse{
		Templates: service.OrderedTemplates(templateMap),
	})
}

// HandlePutPromptTemplate saves one editable system prompt template.
func (handler PromptTemplates) HandlePutPromptTemplate(context *gin.Context) {
	payload, err := decodeJSON[service.PromptTemplate](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}

	templateID := context.Param("id")
	template, err := handler.store.Save(context.Request.Context(), templateID, payload)
	if err != nil {
		writePromptTemplateError(context, err)
		return
	}

	httpresponse.OK(context, template)
}

func writePromptTemplateError(context *gin.Context, err error) {
	if errors.Is(err, service.ErrInvalidTemplate) {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
}
