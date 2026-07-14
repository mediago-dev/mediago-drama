package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	servicecodexskill "github.com/mediago-dev/mediago-drama/services/server/internal/service/codexskill"
)

// CodexSkillService defines the read-only inventory operations consumed by the HTTP layer.
type CodexSkillService interface {
	List(context.Context) (servicecodexskill.ListResponse, error)
	Get(context.Context, string) (servicecodexskill.Detail, error)
}

// CodexSkills handles read-only global Codex skill inventory routes.
type CodexSkills struct {
	service CodexSkillService
}

// NewCodexSkills returns a read-only Codex skill handler.
func NewCodexSkills(service CodexSkillService) CodexSkills {
	return CodexSkills{service: service}
}

// HandleListCodexSkills godoc
// @Summary 获取 Codex 全局 Skill 清单
// @Description 只读返回服务所在设备可发现的 Codex Skill 及预计可用性诊断。
// @Tags Codex Skills
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/codex-skills [get]
func (handler CodexSkills) HandleListCodexSkills(context *gin.Context) {
	result, err := handler.service.List(context.Request.Context())
	if err != nil {
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, result)
}

// HandleGetCodexSkill godoc
// @Summary 获取 Codex Skill 详情
// @Description 通过不透明 ID 返回一个已发现 Skill 的受限原始内容和诊断。
// @Tags Codex Skills
// @Produce json
// @Param id path string true "Opaque Codex Skill ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/codex-skills/{id} [get]
func (handler CodexSkills) HandleGetCodexSkill(context *gin.Context) {
	detail, err := handler.service.Get(context.Request.Context(), context.Param("id"))
	if err != nil {
		if errors.Is(err, servicecodexskill.ErrNotFound) {
			httpresponse.Error(context, http.StatusNotFound, "Codex Skill 不存在")
			return
		}
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
		return
	}
	httpresponse.OK(context, detail)
}
