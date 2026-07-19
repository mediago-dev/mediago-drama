package handlers

import (
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"
	instructionpack "github.com/mediago-dev/mediago-drama/packages/instructions/pkg/pack"
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

type forkPromptPackRequest struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
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

type createPromptPackEntryRequest struct {
	CategoryID string               `json:"categoryId"`
	Kind       instructionpack.Kind `json:"kind"`
	Slug       string               `json:"slug"`
}

type updatePromptPackEntryRequest struct {
	EntryID     string         `json:"entryId"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Body        string         `json:"body"`
	Metadata    map[string]any `json:"metadata"`
}

type promptPackCategoryRequest struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Order int    `json:"order"`
}

type deletePromptPackCategoryRequest struct {
	ReplacementCategoryID string `json:"replacementCategoryId"`
}

type deletePromptPackResponse struct {
	Deleted bool `json:"deleted"`
}

// HandleCreatePack godoc
// @Summary 创建本地技能包
// @Description 创建一个可编辑、可导出的本地技能包。
// @Tags Skill Packs
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

// HandleForkPack godoc
// @Summary 复制技能包
// @Description 将技能包当前解析后的内容复制为一个具有随机 ID 的本地技能包。
// @Tags Skill Packs
// @Accept json
// @Produce json
// @Param id path string true "Source pack ID"
// @Param payload body SwaggerObject true "Fork metadata"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/fork [post]
func (handler PromptPacks) HandleForkPack(context *gin.Context) {
	payload, err := decodeJSON[forkPromptPackRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	pack, err := handler.store.ForkPack(
		context.Request.Context(),
		context.Param("id"),
		promptpack.ForkPackInput{
			Name:        payload.Name,
			Version:     payload.Version,
			Description: payload.Description,
		},
	)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, pack)
}

// HandleExportPack godoc
// @Summary 导出技能包
// @Description 按 MediaGo .mgpack 格式导出一个完整技能包。
// @Tags Skill Packs
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
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": exported.FileName})
	context.Header("Content-Disposition", disposition)
	context.Data(http.StatusOK, "application/octet-stream", exported.Data)
}

// HandleImportPack godoc
// @Summary 导入用户技能包
// @Description 上传并安装一个 MediaGo .mgpack 技能包。
// @Tags Skill Packs
// @Accept multipart/form-data
// @Produce json
// @Param file formData file true "Prompt pack .mgpack file"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 422 {object} SwaggerEnvelope
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
// @Summary 获取技能包列表
// @Description 返回已安装的全局技能包。
// @Tags Skill Packs
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
// @Summary 获取技能包内容
// @Description 返回一个技能包实际拥有的 Skill 和提示词条目。
// @Tags Skill Packs
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

// HandleCreatePackCategory godoc
// @Summary 新建技能包提示词分组
// @Description 在指定技能包中创建一个提示词分组。
// @Tags Skill Packs
// @Accept json
// @Produce json
// @Router /api/v1/packs/{id}/categories [post]
func (handler PromptPacks) HandleCreatePackCategory(context *gin.Context) {
	payload, err := decodeJSON[promptPackCategoryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	category, err := handler.store.CreatePackCategory(context.Request.Context(), context.Param("id"), promptpack.Category{
		ID:    payload.ID,
		Label: payload.Label,
		Order: payload.Order,
	})
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, category)
}

// HandleUpdatePackCategory godoc
// @Summary 更新技能包提示词分组
// @Description 重命名或调整指定技能包中的提示词分组顺序。
// @Tags Skill Packs
// @Accept json
// @Produce json
// @Router /api/v1/packs/{id}/categories/{categoryId} [put]
func (handler PromptPacks) HandleUpdatePackCategory(context *gin.Context) {
	payload, err := decodeJSON[promptPackCategoryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	category, err := handler.store.UpdatePackCategory(
		context.Request.Context(),
		context.Param("id"),
		context.Param("categoryId"),
		promptpack.Category{Label: payload.Label, Order: payload.Order},
	)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, category)
}

// HandleDeletePackCategory godoc
// @Summary 删除技能包提示词分组
// @Description 删除分组并将其中的提示词移动到同一技能包中的替代分组。
// @Tags Skill Packs
// @Accept json
// @Produce json
// @Router /api/v1/packs/{id}/categories/{categoryId} [delete]
func (handler PromptPacks) HandleDeletePackCategory(context *gin.Context) {
	payload, err := decodeJSON[deletePromptPackCategoryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	if err := handler.store.DeletePackCategory(
		context.Request.Context(),
		context.Param("id"),
		context.Param("categoryId"),
		payload.ReplacementCategoryID,
	); err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, deletePromptPackResponse{Deleted: true})
}

// HandleCopyPackEntries godoc
// @Summary 添加内容到本地技能包
// @Description 将选中的 Skill 和提示词作为同步引用加入目标本地包。
// @Tags Skill Packs
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

// HandleCreatePackEntry godoc
// @Summary 新建技能包草稿内容
// @Description 在本地创作技能包中创建一个可自动保存的空 Skill 或提示词草稿。
// @Tags Skill Packs
// @Accept json
// @Produce json
// @Param id path string true "Target pack ID"
// @Param payload body SwaggerObject true "Draft entry"
// @Success 200 {object} SwaggerEnvelope
// @Failure 400 {object} SwaggerEnvelope
// @Failure 403 {object} SwaggerEnvelope
// @Failure 404 {object} SwaggerEnvelope
// @Failure 409 {object} SwaggerEnvelope
// @Failure 500 {object} SwaggerEnvelope
// @Router /api/v1/packs/{id}/entries [post]
func (handler PromptPacks) HandleCreatePackEntry(context *gin.Context) {
	payload, err := decodeJSON[createPromptPackEntryRequest](context)
	if err != nil {
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
		return
	}
	entry, err := handler.store.CreatePackEntryDraft(
		context.Request.Context(),
		context.Param("id"),
		payload.Kind,
		payload.Slug,
		payload.CategoryID,
	)
	if err != nil {
		writePromptPackError(context, err)
		return
	}
	httpresponse.OK(context, entry)
}

// HandlePutPackEntry godoc
// @Summary 保存技能包内指定内容
// @Description 按技能包 ID 和条目 ID 精确保存 Skill 或提示词，不使用全局 slug 解析。
// @Tags Skill Packs
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
// @Summary 恢复技能包内指定内容
// @Description 按技能包 ID 和条目 ID 精确恢复已导入正式包中的原始内容。
// @Tags Skill Packs
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
// @Summary 将引用内容转为技能包副本
// @Description 将一个同步引用的 Skill 或提示词冻结为目标本地技能包独立拥有的副本。
// @Tags Skill Packs
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
// @Summary 从技能包移除内容
// @Description 删除目标技能包中的用户内容，或以本地覆盖方式隐藏包自带的 Skill 或提示词。
// @Tags Skill Packs
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
// @Summary 安装技能包
// @Description 从本地目录或 .mgpack 文件安装技能包。
// @Tags Skill Packs
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
// @Summary 更新技能包
// @Description 启用或禁用一个技能包。
// @Tags Skill Packs
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
// @Summary 卸载技能包
// @Description 删除一个导入的技能包；默认包不可卸载。
// @Tags Skill Packs
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
// @Summary 恢复技能包默认内容
// @Description 将技能包内的默认技能和提示词预设恢复为安装包内容；用户新增内容会保留。
// @Tags Skill Packs
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
	case errors.Is(err, promptpack.ErrProtectedPackAccessDenied):
		httpresponse.Error(
			context,
			http.StatusForbidden,
			"当前 MediaGo 账号没有该技能包的导入权限，请在 MediaGo 授权页面完成购买或加入发布者席位后重新导入",
		)
	case errors.Is(err, promptpack.ErrProtectedPackAuthorizationExpired):
		httpresponse.Error(
			context,
			http.StatusRequestTimeout,
			"技能包授权已过期，请重新导入并完成授权",
		)
	case errors.Is(err, promptpack.ErrProtectedPackUnavailable):
		httpresponse.Error(
			context,
			http.StatusServiceUnavailable,
			"技能包授权服务暂时不可用，请稍后重试",
		)
	case errors.Is(err, promptpack.ErrUnprotectedPackImportDenied):
		httpresponse.Error(
			context,
			http.StatusUnprocessableEntity,
			"未加密技能包不能直接导入，请先前往 MediaGo 官网完成发布和加密",
		)
	case errors.Is(err, promptpack.ErrUnsupportedPackVersion):
		httpresponse.Error(
			context,
			http.StatusUnprocessableEntity,
			"当前构建不支持此技能包版本，请使用 MediaGo Drama 官方版导入",
		)
	case errors.Is(err, promptpack.ErrInvalidPack):
		httpresponse.ErrorFromStatus(context, http.StatusBadRequest, err)
	case errors.Is(err, promptpack.ErrPackExists), errors.Is(err, promptpack.ErrEntryExists), errors.Is(err, promptpack.ErrCategoryExists):
		httpresponse.ErrorFromStatus(context, http.StatusConflict, err)
	case errors.Is(err, promptpack.ErrPackReadonly):
		httpresponse.ErrorFromStatus(context, http.StatusForbidden, err)
	case errors.Is(err, promptpack.ErrPackNotFound), errors.Is(err, promptpack.ErrEntryNotFound), errors.Is(err, promptpack.ErrCategoryNotFound):
		httpresponse.ErrorFromStatus(context, http.StatusNotFound, err)
	default:
		httpresponse.Fail(context, http.StatusInternalServerError, "internal error", err)
	}
}
