package handlers

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	httpresponse "github.com/mediago-dev/mediago-drama/services/server/internal/http/response"
	"github.com/mediago-dev/mediago-drama/services/server/internal/service/promptpack"
)

// PromptPacks handles prompt pack management routes.
type PromptPacks struct {
	store *promptpack.Service
}

// NewPromptPacks returns a prompt pack route handler.
func NewPromptPacks(store *promptpack.Service) PromptPacks {
	return PromptPacks{store: store}
}

type promptPackListResponse struct {
	Packs []promptpack.Pack `json:"packs"`
}

type installPromptPackRequest struct {
	Path string `json:"path"`
}

type createPromptPackRequest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author"`
	Description string `json:"description"`
}

type updatePromptPackRequest struct {
	Enabled *bool `json:"enabled"`
}

type copyPromptPackEntriesRequest struct {
	Entries []promptpack.EntryReference `json:"entries"`
}

type copyPromptPackEntriesResponse struct {
	Entries []promptpack.Entry `json:"entries"`
}

type promptPackEntryRequest struct {
	EntryID string `json:"entryId"`
}

type updatePromptPackEntryRequest struct {
	EntryID     string         `json:"entryId"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Body        string         `json:"body"`
	Metadata    map[string]any `json:"metadata"`
}

type deletePromptPackResponse struct {
	Deleted bool `json:"deleted"`
}

// HandleCreatePack godoc
// @Summary 创建本地提示词包
// @Description 创建一个可编辑、可导出的本地提示词包。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Prompt pack payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs [post]
func (handler PromptPacks) HandleCreatePack(context *gin.Context) {
	payload, err := decodeJSON[createPromptPackRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	pack, err := handler.store.CreatePack(context.Request.Context(), promptpack.Pack{
		ID:          payload.ID,
		Name:        payload.Name,
		Version:     payload.Version,
		Author:      payload.Author,
		Description: payload.Description,
	})
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandleExportPack godoc
// @Summary 导出提示词包
// @Description 按 MediaGo .mgpack 格式导出一个完整提示词包。
// @Tags Prompt Packs
// @Produce octet-stream
// @Param id path string true "Pack ID"
// @Success 200 {file} file
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/export [get]
func (handler PromptPacks) HandleExportPack(context *gin.Context) {
	exported, err := handler.store.ExportPack(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	context.Header("Content-Type", "application/octet-stream")
	context.Header(
		"Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(exported.FileName, `"`, "")),
	)
	context.Data(http.StatusOK, "application/octet-stream", exported.Data)
}

// HandleImportPack godoc
// @Summary 导入用户提示词包
// @Description 上传并安装一个 MediaGo .mgpack 提示词包。
// @Tags Prompt Packs
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "Prompt pack .mgpack file"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/import [post]
func (handler PromptPacks) HandleImportPack(context *gin.Context) {
	file, err := context.FormFile("file")
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, errors.New("file is required"))
		return
	}
	source, err := file.Open()
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	defer source.Close()
	data, err := io.ReadAll(io.LimitReader(source, promptpack.MaxUploadBytes()+1))
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	pack, err := handler.store.InstallData(context.Request.Context(), file.Filename, data)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandleListPacks godoc
// @Summary 获取提示词包列表
// @Description 返回已安装的全局提示词包。
// @Tags Prompt Packs
// @Produce json
// @Success 200 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs [get]
func (handler PromptPacks) HandleListPacks(context *gin.Context) {
	packs, err := handler.store.ListPacks(context.Request.Context())
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, promptPackListResponse{Packs: packs})
}

// HandleGetPackContents godoc
// @Summary 获取提示词包内容
// @Description 返回一个提示词包实际拥有的 Skill 和提示词条目。
// @Tags Prompt Packs
// @Produce json
// @Param id path string true "Pack ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/contents [get]
func (handler PromptPacks) HandleGetPackContents(context *gin.Context) {
	contents, err := handler.store.GetPackContents(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, contents)
}

// HandleCopyPackEntries godoc
// @Summary 添加内容到本地提示词包
// @Description 将选中的 Skill 和提示词作为同步引用加入目标本地包。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param id path string true "Target pack ID"
// @Param payload body SwaggerObject true "Entry references"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/entries/copy [post]
func (handler PromptPacks) HandleCopyPackEntries(context *gin.Context) {
	payload, err := decodeJSON[copyPromptPackEntriesRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	entries, err := handler.store.CopyEntries(context.Request.Context(), context.Param("id"), payload.Entries)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, copyPromptPackEntriesResponse{Entries: entries})
}

// HandlePutPackEntry godoc
// @Summary 保存词包内指定内容
// @Description 按词包 ID 和条目 ID 精确保存 Skill 或提示词，不使用全局 slug 解析。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param id path string true "Target pack ID"
// @Param payload body SwaggerObject true "Entry update"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/entries [put]
func (handler PromptPacks) HandlePutPackEntry(context *gin.Context) {
	payload, err := decodeJSON[updatePromptPackEntryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	entry, err := handler.store.SavePackEntry(
		context.Request.Context(),
		context.Param("id"),
		payload.EntryID,
		promptpack.EntryUpdate{
			Name:        payload.Name,
			Description: payload.Description,
			Body:        payload.Body,
			Metadata:    payload.Metadata,
		},
	)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, entry)
}

// HandleResetPackEntry godoc
// @Summary 恢复词包内指定内容
// @Description 按词包 ID 和条目 ID 精确恢复已导入正式包中的原始内容。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param id path string true "Target pack ID"
// @Param payload body SwaggerObject true "Entry ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/entries/reset [post]
func (handler PromptPacks) HandleResetPackEntry(context *gin.Context) {
	payload, err := decodeJSON[promptPackEntryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	entry, err := handler.store.ResetPackEntry(
		context.Request.Context(),
		context.Param("id"),
		payload.EntryID,
	)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, entry)
}

// HandleDetachPackEntry godoc
// @Summary 将引用内容转为词包副本
// @Description 将一个同步引用的 Skill 或提示词冻结为目标本地词包独立拥有的副本。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param id path string true "Target pack ID"
// @Param payload body SwaggerObject true "Entry ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/entries/detach [post]
func (handler PromptPacks) HandleDetachPackEntry(context *gin.Context) {
	payload, err := decodeJSON[promptPackEntryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	entry, err := handler.store.DetachEntry(
		context.Request.Context(),
		context.Param("id"),
		payload.EntryID,
	)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, entry)
}

// HandleRemovePackEntry godoc
// @Summary 从本地提示词包移除内容
// @Description 从目标本地词包移除一个直接拥有或同步引用的 Skill 或提示词。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param id path string true "Target pack ID"
// @Param payload body SwaggerObject true "Entry ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/entries/remove [post]
func (handler PromptPacks) HandleRemovePackEntry(context *gin.Context) {
	payload, err := decodeJSON[promptPackEntryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if err := handler.store.RemoveEntry(
		context.Request.Context(),
		context.Param("id"),
		payload.EntryID,
	); err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, deletePromptPackResponse{Deleted: true})
}

// HandleInstallPack godoc
// @Summary 安装提示词包
// @Description 从本地目录或 .mgpack 文件安装提示词包。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param payload body SwaggerObject true "Install payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/install [post]
func (handler PromptPacks) HandleInstallPack(context *gin.Context) {
	payload, err := decodeJSON[installPromptPackRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	pack, err := handler.store.InstallPath(context.Request.Context(), payload.Path)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandlePatchPack godoc
// @Summary 更新提示词包
// @Description 启用或禁用一个提示词包。
// @Tags Prompt Packs
// @Accept json
// @Produce json
// @Param id path string true "Pack ID"
// @Param payload body SwaggerObject true "Patch payload"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id} [patch]
func (handler PromptPacks) HandlePatchPack(context *gin.Context) {
	payload, err := decodeJSON[updatePromptPackRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if payload.Enabled == nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, errors.New("enabled is required"))
		return
	}
	pack, err := handler.store.SetEnabled(context.Request.Context(), context.Param("id"), *payload.Enabled)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandleDeletePack godoc
// @Summary 卸载提示词包
// @Description 删除一个导入的提示词包；默认包不可卸载。
// @Tags Prompt Packs
// @Produce json
// @Param id path string true "Pack ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id} [delete]
func (handler PromptPacks) HandleDeletePack(context *gin.Context) {
	if err := handler.store.Uninstall(context.Request.Context(), context.Param("id")); err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, deletePromptPackResponse{Deleted: true})
}

// HandleResetPack godoc
// @Summary 恢复提示词包默认内容
// @Description 将提示词包内的默认技能和提示词预设恢复为安装包内容；用户新增内容会保留。
// @Tags Prompt Packs
// @Produce json
// @Param id path string true "Pack ID"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/reset [post]
func (handler PromptPacks) HandleResetPack(context *gin.Context) {
	pack, err := handler.store.ResetPack(context.Request.Context(), context.Param("id"))
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

func writePromptPackError(context *gin.Context, err error) {
	switch {
	case errors.Is(err, promptpack.ErrInvalidPack):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, promptpack.ErrPackExists), errors.Is(err, promptpack.ErrEntryExists):
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
	case errors.Is(err, promptpack.ErrPackReadonly):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, promptpack.ErrPackNotFound), errors.Is(err, promptpack.ErrEntryNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}
