package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	service "github.com/mediago-dev/mediago-drama/services/server/internal/service/prompttemplates"
)

// PromptTemplateService supplies prompt template persistence.
type PromptTemplateService interface {
	Load(ctx context.Context) (map[string]service.PromptTemplate, error)
	Save(ctx context.Context, id string, template service.PromptTemplate) (service.PromptTemplate, error)
	Reset(ctx context.Context, id string) (service.PromptTemplate, error)
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

// HandleListPromptTemplates godoc
// @Summary 获取系统提示词模板
// @Description 返回可编辑的系统提示词模板列表。
// @Tags Prompt Templates
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-templates [get]
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

// HandlePutPromptTemplate godoc
// @Summary 保存系统提示词模板
// @Description 保存一个可编辑系统提示词模板的 Markdown 内容。
// @Tags Prompt Templates
// @Accept json
// @Produce json
// @Param id path string true "Template ID"
// @Param payload body SwaggerObject true "Prompt template payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-templates/{id} [put]
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

// HandleResetPromptTemplate godoc
// @Summary 恢复系统提示词模板
// @Description 将一个可编辑系统提示词模板恢复为官方默认内容。
// @Tags Prompt Templates
// @Produce json
// @Param id path string true "Template ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/prompt-templates/{id}/reset [post]
func (handler PromptTemplates) HandleResetPromptTemplate(context *gin.Context) {
	template, err := handler.store.Reset(context.Request.Context(), context.Param("id"))
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
