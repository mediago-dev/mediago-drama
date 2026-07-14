package mcp

import (
	"context"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// ToolDefinition is the stable contract metadata exposed by the MediaGo Drama MCP server.
type ToolDefinition struct {
	Name        string
	Title       string
	Description string
	Destructive bool
	ReadOnly    bool
}

const mcpWorkflowInstructions = `MediaGo Drama MCP 使用说明：
- Agent 进程启动时当前工作目录已经是当前项目的文档根目录（项目的 work 文件夹）；当前目录树就是文档树，Markdown 文件就是文档。不要再访问或创建名为 work/ 的子目录。
- 读取、创建、修改、移动和删除文档时，直接操作当前工作目录 . 下的本地文件；不要通过 MCP 读取或编辑文档正文。
- 需要读取项目配置时调用 get_project_config；不要在当前工作目录或父目录中搜索 project.media.json。项目配置不再承载视觉风格，风格提示应来自用户本轮需求或提示词包。
- load_skill 用于按任务装载 screenplay、character、scene、prop、storyboard 等写作 Skill，以及 image-generation、video-generation 等工作流 Skill；核心文档规则仍由系统 prompt 注入，不依赖 Skill。
- get_project_config 用于读取当前项目配置，例如提示词分类默认预设。
- list_comments / get_comment / mutate_comment 用于读取和处理评论/批注；mutate_comment.op 支持 add、update、reply、resolve、unresolve、delete。
- 用户划词后的局部任务应转成评论/批注处理，不依赖瞬时编辑器选区。`

// AgentMCPInstructions describes the run-scoped MCP server contract returned
// during MCP initialize.
const AgentMCPInstructions = mcpWorkflowInstructions + `
- 本 MCP 只提供 load_skill、get_project_config、update_project_config、list_comments、get_comment、mutate_comment、ask_user_selection、ask_user_form、await_user_selection。
- update_project_config 当前仅用于更新 overview.categoryDefaults；style 风格分类会被忽略。
- ask_user_selection 向用户展示可视化选项并阻塞等待选择，返回 selected/custom/cancelled/timeout。
- ask_user_form 向用户展示参数表单，支持 select、toggle、number、text、generation_settings、generation_params、images 和 prompt_optimization 字段，提交后返回 values。
- 图片生成参数确认必须用 kind=generation_plan，且只传一个 required generation_settings(kind=image)，其中一次性确认 route/params/references/prompt supplements/prompt optimization；不得再混用 generation_params、images、prompt_optimization 或通用字段。视频本轮兼容 generation_params(kind=video) 加可选 images/prompt_optimization。
- 两者返回 timeout 只表示一次 MCP 传输等待结束，不是用户决定。必须用 await_user_selection 对同一 selectionId 持续续等且不设轮数上限；pending/timeout 时不得调用其他工具、继续业务、结束回合或发送最终答复。返回 cancelled/expired 时停止；生成表单只有 status=submitted 才能继续，关闭弹窗不算提交。`

// ExternalMCPInstructions describes the cross-project MCP server contract.
const ExternalMCPInstructions = mcpWorkflowInstructions + `
- 本 MCP 只提供 list_projects、load_skill、get_project_config、list_comments、get_comment、mutate_comment。
- external cross-project server 的 get_project_config 和评论工具参数必须携带 projectId。`

// GenerationMCPInstructions describes the generation MCP server contract.
const GenerationMCPInstructions = `MediaGo Drama Generation MCP 使用说明：
- 本 MCP 只提供 MediaGo Drama 生成工作台能力，不提供文档正文读写。
- list_generation_models 返回模型目录、routeId、参数 schema、configured 状态和 preferences；configured 表示当前路由是否可提交。视觉风格等补充内容来自用户本轮需求或统一生成设置表单中的动态提示词包，不存在单独的全局风格选择步骤。
- generate_media 用于提交生成请求；kind 默认 image。prompt 必填，routeId/model/params 应来自模型目录或用户明确输入。Agent 发起图片或视频生成时必须传已提交 generation_plan 的 confirmationSelectionId，并只传表单确认的 routeId（不要再传 familyId/versionId/provider/modelId/model 覆盖模型）；服务端会核验当前 project/session/run 及已确认的 routeId、params、referenceAssetIds、promptSupplements 和 promptOptimization。
- generate_media_batch 用于一次提交多个独立媒体生成请求；返回 batch id 和每项 taskId，单项失败不会取消其他项。Agent 的图片/视频批次中每个 request 都必须传 confirmationSelectionId，并逐项核验 routeId、params、referenceAssetIds、promptSupplements 和 promptOptimization。
- generate_media 返回的 id 即生成任务的 taskId；status 为 submitting/submitted 时任务在后台运行，用返回的 id 调 poll_generation_task 或 get_generation_task 查询结果。
- referenceUrls/referenceAssetIds/referenceBindings 可用于传入参考图、参考素材或文档绑定。
- documentContext（documentId + sectionId）把任务归入项目资源的生成历史与选中资产库；资源归属由服务端按目标文档类型自动判定。
- notificationTarget 指定生成完成通知跳转的项目文档章节。
- promptOptimization 请求服务端先优化提示词再生成，响应中的 optimizedPrompt 是实际生成提示词。
- get_generation_task / list_generation_tasks 用于查询任务状态和结果资产。
- poll_generation_task 用于轮询需要供应商查询的异步任务；retry_generation_task 用于重试失败或可重试任务。
- select_generation_asset 按 taskId 和 slotIndex 标记选中资产；未带 documentContext 的任务可补传 resourceType。`

const publicMCPBoundaryDescription = "MediaGo Drama MCP：Agent 当前工作目录已是项目 work 文档根目录；文档读写直接操作当前目录下的 Markdown 文件，不要再访问 work/ 子目录；项目配置通过 MCP 读取或更新，不要搜索 project.media.json。"

// DocumentTools contains the run-scoped document MCP tool definitions.
var DocumentTools = struct {
	LoadSkill           ToolDefinition
	GetProjectConfig    ToolDefinition
	UpdateProjectConfig ToolDefinition
	ListComments        ToolDefinition
	GetComment          ToolDefinition
	MutateComment       ToolDefinition
}{
	LoadSkill:           ToolDefinition{Name: "load_skill", Title: "装载 Agent Skill", Description: "按 name 装载一个可用 Skill，返回 frontmatter 之外的任务说明。核心文档规则由系统 prompt 注入，不依赖 Skill 或 template_id。编辑 screenplay/character/scene/prop/storyboard 类型文档前必须先装载对应写作 Skill；图片生成按系统指示装载 image-generation，视频生成装载 video-generation。", ReadOnly: true},
	GetProjectConfig:    ToolDefinition{Name: "get_project_config", Title: "读取项目配置", Description: "读取当前项目配置，例如提示词分类默认预设；项目配置不再承载视觉风格，不要通过文件系统查找 project.media.json。", ReadOnly: true},
	UpdateProjectConfig: ToolDefinition{Name: "update_project_config", Title: "更新项目配置", Description: "按字段更新当前项目的 project.media.json；当前仅支持 overview.categoryDefaults，style 风格分类会被忽略。"},
	ListComments:        ToolDefinition{Name: "list_comments", Title: "列出评论线程", Description: "按文档、块和解决状态列出评论线程。", ReadOnly: true},
	GetComment:          ToolDefinition{Name: "get_comment", Title: "读取评论线程", Description: "按 commentId 读取单个评论线程。", ReadOnly: true},
	MutateComment:       ToolDefinition{Name: "mutate_comment", Title: "修改评论线程", Description: "统一评论 mutation 入口；op 支持 add、update、reply、resolve、unresolve、delete。用于处理划词评论、回复或解决评论线程。"},
}

// ExternalTools contains cross-project MCP tool definitions.
var ExternalTools = struct {
	ListProjects     ToolDefinition
	GetProjectConfig ToolDefinition
	ListComments     ToolDefinition
	GetComment       ToolDefinition
	MutateComment    ToolDefinition
}{
	ListProjects:     ToolDefinition{Name: "list_projects", Title: "列出项目（外部）", Description: "列出当前 MediaGo Drama workspace 中的所有项目。", ReadOnly: true},
	GetProjectConfig: ToolDefinition{Name: "get_project_config", Title: "读取项目配置（外部）", Description: "按 projectId 读取项目配置，例如提示词分类默认预设；项目配置不再承载视觉风格。", ReadOnly: true},
	ListComments:     ToolDefinition{Name: "list_comments", Title: "列出评论（外部）", Description: "按文档、块和解决状态列出评论线程。", ReadOnly: true},
	GetComment:       ToolDefinition{Name: "get_comment", Title: "读取评论（外部）", Description: "按 commentId 读取单个评论线程。", ReadOnly: true},
	MutateComment:    ToolDefinition{Name: "mutate_comment", Title: "修改评论（外部）", Description: "统一评论 mutation 入口；op 支持 add、update、reply、resolve、unresolve、delete。"},
}

// GenerationTools contains generation MCP tool definitions.
var GenerationTools = struct {
	ListModels    ToolDefinition
	Generate      ToolDefinition
	GenerateBatch ToolDefinition
	GetTask       ToolDefinition
	ListTasks     ToolDefinition
	RetryTask     ToolDefinition
	PollTask      ToolDefinition
	SelectAsset   ToolDefinition
}{
	ListModels:    ToolDefinition{Name: "list_generation_models", Title: "列出生成模型", Description: "返回 MediaGo Drama 当前可用的生成模型目录、routeId、参数 schema、供应商配置状态和用户偏好。可传 kind（image/video/audio/text）只返回对应类型；视觉风格等补充内容由统一生成设置表单中的动态提示词包选择。", ReadOnly: true},
	Generate:      ToolDefinition{Name: "generate_media", Title: "提交媒体生成", Description: "提交图片、视频、音频或文本生成请求；prompt 必填，kind 默认 image，routeId/model/params 应来自 list_generation_models。Agent 发起图片或视频生成时必须传已提交 generation_plan 的 confirmationSelectionId；服务端核验同 project/session/run 以及 routeId、params、referenceAssetIds、promptSupplements、promptOptimization 与确认值一致。"},
	GenerateBatch: ToolDefinition{Name: "generate_media_batch", Title: "批量提交媒体生成", Description: "一次提交最多 50 个独立媒体生成请求；每项 request 与 generate_media 相同，Agent 图片/视频批次的每项都必须传 confirmationSelectionId，并逐项核验 routeId、params、referenceAssetIds、promptSupplements、promptOptimization；返回批次 ID、每项 taskId 或独立错误。"},
	GetTask:       ToolDefinition{Name: "get_generation_task", Title: "读取生成任务", Description: "按 taskId 读取生成任务的状态、结果资产、错误信息和尝试记录。", ReadOnly: true},
	ListTasks:     ToolDefinition{Name: "list_generation_tasks", Title: "列出生成任务", Description: "按 batchId、projectId、sessionId、kind、limit、offset 列出生成任务。", ReadOnly: true},
	RetryTask:     ToolDefinition{Name: "retry_generation_task", Title: "重试生成任务", Description: "按 taskId 重新提交失败或可重试的生成任务。"},
	PollTask:      ToolDefinition{Name: "poll_generation_task", Title: "轮询生成任务", Description: "按 taskId 轮询异步生成任务并同步最新状态。"},
	SelectAsset:   ToolDefinition{Name: "select_generation_asset", Title: "选定生成结果", Description: "按 taskId + slotIndex 把某张生成结果标记为选中（用户选片后调用），返回更新后的任务。"},
}

// AgentDocumentTools is the public run-scoped MCP surface exposed to agents.
var AgentDocumentTools = struct {
	LoadSkill           ToolDefinition
	GetProjectConfig    ToolDefinition
	UpdateProjectConfig ToolDefinition
	ListComments        ToolDefinition
	GetComment          ToolDefinition
	MutateComment       ToolDefinition
	AskUserSelection    ToolDefinition
	AskUserForm         ToolDefinition
	AwaitUserSelection  ToolDefinition
}{
	LoadSkill: ToolDefinition{
		Name:        DocumentTools.LoadSkill.Name,
		Title:       DocumentTools.LoadSkill.Title,
		Description: publicMCPBoundaryDescription + " " + DocumentTools.LoadSkill.Description,
		ReadOnly:    true,
	},
	AskUserSelection: ToolDefinition{
		Name:        "ask_user_selection",
		Title:       "请用户选择",
		Description: "向用户展示一组可视化选项（如目标资源或生成结果）并阻塞等待其选择：返回所选 optionId（selected）、自定义描述（custom）、取消（cancelled）、过期（expired）或传输心跳（timeout）。options 必填，每项含 id/label，可带 imageUrl/description（自然语言，不要暴露内部字段名）。timeout 不是用户决定；必须用 await_user_selection 对同一 selectionId 持续等待且不设轮数上限，期间不得调用其他工具、结束回合或继续业务。",
	},
	AskUserForm: ToolDefinition{
		Name:        "ask_user_form",
		Title:       "请用户填写表单",
		Description: "向用户展示一张参数表单卡并阻塞等待提交。图片生成确认必须传 kind=generation_plan，且只含一个 required generation_settings(kind=image)；它渲染与批量生成同源的完整设置，并提交 {kind,routeId,label,params,referenceAssetIds,promptSupplements,promptOptimization}。不得与 generation_params、images、prompt_optimization 或通用字段混用。视频本轮兼容一个 generation_params(kind=video) 加至多一个 images 和 prompt_optimization。结果为 status=submitted 与 values。timeout 只是传输心跳；必须对同一 selectionId 持续 await，pending/timeout 时不得生成、调用其他工具、结束回合或发送最终答复。",
	},
	AwaitUserSelection: ToolDefinition{
		Name:        "await_user_selection",
		Title:       "继续等待用户选择",
		Description: "继续阻塞等待一张已存在的选择卡或表单（不新建卡片）：传入原 ask_user_selection/ask_user_form 返回的 selectionId，返回值与原工具相同。用于把长等待拆成多轮 ≤90 秒的传输等待；timeout 不是用户决定，再次 timeout 时必须对同一 ID 继续调用本工具且不设轮数上限。等待期间不得调用其他工具、继续业务、结束回合或发送最终答复；selected/submitted/custom 后继续，cancelled/expired 后停止。",
		ReadOnly:    true,
	},
	GetProjectConfig: ToolDefinition{
		Name:        DocumentTools.GetProjectConfig.Name,
		Title:       DocumentTools.GetProjectConfig.Title,
		Description: publicMCPBoundaryDescription + " " + DocumentTools.GetProjectConfig.Description,
		ReadOnly:    true,
	},
	UpdateProjectConfig: ToolDefinition{
		Name:        DocumentTools.UpdateProjectConfig.Name,
		Title:       DocumentTools.UpdateProjectConfig.Title,
		Description: publicMCPBoundaryDescription + " " + DocumentTools.UpdateProjectConfig.Description,
	},
	ListComments: ToolDefinition{
		Name:        DocumentTools.ListComments.Name,
		Title:       DocumentTools.ListComments.Title,
		Description: publicMCPBoundaryDescription + " " + DocumentTools.ListComments.Description,
		ReadOnly:    true,
	},
	GetComment: ToolDefinition{
		Name:        DocumentTools.GetComment.Name,
		Title:       DocumentTools.GetComment.Title,
		Description: publicMCPBoundaryDescription + " " + DocumentTools.GetComment.Description,
		ReadOnly:    true,
	},
	MutateComment: ToolDefinition{
		Name:        DocumentTools.MutateComment.Name,
		Title:       DocumentTools.MutateComment.Title,
		Description: publicMCPBoundaryDescription + " " + DocumentTools.MutateComment.Description,
	},
}

// ExternalDocumentTools is the public cross-project MCP surface.
var ExternalDocumentTools = struct {
	ListProjects     ToolDefinition
	LoadSkill        ToolDefinition
	GetProjectConfig ToolDefinition
	ListComments     ToolDefinition
	GetComment       ToolDefinition
	MutateComment    ToolDefinition
}{
	ListProjects: ExternalTools.ListProjects,
	LoadSkill:    AgentDocumentTools.LoadSkill,
	GetProjectConfig: ToolDefinition{
		Name:        ExternalTools.GetProjectConfig.Name,
		Title:       ExternalTools.GetProjectConfig.Title,
		Description: publicMCPBoundaryDescription + " " + ExternalTools.GetProjectConfig.Description,
		ReadOnly:    true,
	},
	ListComments: ToolDefinition{
		Name:        ExternalTools.ListComments.Name,
		Title:       ExternalTools.ListComments.Title,
		Description: publicMCPBoundaryDescription + " " + ExternalTools.ListComments.Description,
		ReadOnly:    true,
	},
	GetComment: ToolDefinition{
		Name:        ExternalTools.GetComment.Name,
		Title:       ExternalTools.GetComment.Title,
		Description: publicMCPBoundaryDescription + " " + ExternalTools.GetComment.Description,
		ReadOnly:    true,
	},
	MutateComment: ToolDefinition{
		Name:        ExternalTools.MutateComment.Name,
		Title:       ExternalTools.MutateComment.Title,
		Description: publicMCPBoundaryDescription + " " + ExternalTools.MutateComment.Description,
	},
}

// AddTool registers a MediaGo Drama MCP tool using package-owned contract metadata.
func AddTool[In, Out any](
	server *mcpsdk.Server,
	closedWorld bool,
	logToolRegistered func(string),
	definition ToolDefinition,
	handler mcpsdk.ToolHandlerFor[In, Out],
) {
	wrapped := func(ctx context.Context, request *mcpsdk.CallToolRequest, input In) (*mcpsdk.CallToolResult, any, error) {
		result, output, err := handler(ctx, request, input)
		return result, output, err
	}
	mcpsdk.AddTool(server, &mcpsdk.Tool{
		Name:        definition.Name,
		Title:       definition.Title,
		Description: definition.Description,
		Annotations: &mcpsdk.ToolAnnotations{
			DestructiveHint: boolPtr(definition.Destructive),
			OpenWorldHint:   &closedWorld,
			ReadOnlyHint:    definition.ReadOnly,
		},
	}, wrapped)
	logToolRegistered(definition.Name)
}

func boolPtr(value bool) *bool {
	return &value
}
