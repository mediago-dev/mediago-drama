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
- load_skill 用于装载 screenplay、character、scene、prop、storyboard 等写作 skill；Skill 正文只承载业务写作提示。核心文档规则由系统 prompt 注入，不依赖 Skill。
- get_project_config 用于读取当前项目配置，例如提示词分类默认预设。
- list_comments / get_comment / mutate_comment 用于读取和处理评论/批注；mutate_comment.op 支持 add、update、reply、resolve、unresolve、delete。
- 用户划词后的局部任务应转成评论/批注处理，不依赖瞬时编辑器选区。`

// AgentMCPInstructions describes the run-scoped MCP server contract returned
// during MCP initialize.
const AgentMCPInstructions = mcpWorkflowInstructions + `
- 本 MCP 只提供 load_skill、get_project_config、update_project_config、list_comments、get_comment、mutate_comment、ask_user_selection、ask_user_form、await_user_selection。
- update_project_config 当前仅用于更新 overview.categoryDefaults；style 风格分类会被忽略。
- ask_user_selection 向用户展示可视化选项并阻塞等待选择，返回 selected/custom/cancelled/timeout；生图前用它确认风格或结果选片。
- ask_user_form 向用户展示参数表单（select/toggle/number/text 字段），提交后返回 values；多参数确认（如生成方案）用它，不要拆成多轮单选。
- 两者返回 timeout 时先用 await_user_selection 对同一 selectionId 循环续等 3-5 轮；仍无结果再说明情况并结束回合，不要擅自继续。`

// ExternalMCPInstructions describes the cross-project MCP server contract.
const ExternalMCPInstructions = mcpWorkflowInstructions + `
- 本 MCP 只提供 list_projects、load_skill、get_project_config、list_comments、get_comment、mutate_comment。
- external cross-project server 的 get_project_config 和评论工具参数必须携带 projectId。`

// GenerationMCPInstructions describes the generation MCP server contract.
const GenerationMCPInstructions = `MediaGo Drama Generation MCP 使用说明：
- 本 MCP 只提供 MediaGo Drama 生成工作台能力，不提供文档正文读写。
- 生成图片/视频/音频/文本前优先调用 list_generation_models，确认 routeId、model、params 和 configured 状态；configured 为 false 时先提示用户配置供应商，不要发起生成。
- generate_media 用于提交生成请求；kind 默认 image。prompt 必填，routeId/model/params 应来自模型目录或用户明确输入。
- generate_media 返回的 id 即生成任务的 taskId；status 为 submitting/submitted 时任务在后台运行，用返回的 id 调 poll_generation_task 或 get_generation_task 查询结果。
- referenceUrls/referenceAssetIds/referenceBindings 可用于传入参考图、参考素材或文档绑定。
- get_generation_task / list_generation_tasks 用于查询任务状态和结果资产。
- poll_generation_task 用于轮询需要供应商查询的异步任务；retry_generation_task 用于重试失败或可重试任务。
- stylePresets 来自产品提示词库的 style 分类（内置风格 + 用户自建 + 提示词包），与生成工作台同源；previewUrl 存在时可作为选择卡片的预览图，缺失时用纯文本选项。用户确认某个 preset 后，把它的 promptSuffix 拼到 prompt 末尾、params 合并进请求参数再 generate_media。
- preferences 是用户在生成工作台的习惯参数（kind→routeId、routeId→params）；组生成方案时优先用它做默认值，参数取值必须来自路由 params schema。
- 生成前用一张方案确认卡让用户确认模型/比例/分辨率/张数/是否优化提示词（组 2-4 个完整方案供选择，不要逐参数追问）；用户选定后严格执行。
- generate_media 传入 promptOptimization 时会先优化提示词再生成，返回 optimizedPrompt。
- 一次生成返回多张结果时，让用户选片后调用 select_generation_asset(taskId, slotIndex) 标记选中，再取该资产 URL 使用。`

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
	LoadSkill:           ToolDefinition{Name: "load_skill", Title: "装载 Agent Skill", Description: "按 name 装载一个可用 skill，返回 frontmatter 之外的业务写作提示。核心文档规则由系统 prompt 注入，不依赖 skill 或 template_id。编辑 screenplay/character/scene/prop/storyboard 类型文档前必须先装载对应写作 skill，并同时遵守系统核心文档规则。", ReadOnly: true},
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
	ListModels  ToolDefinition
	Generate    ToolDefinition
	GetTask     ToolDefinition
	ListTasks   ToolDefinition
	RetryTask   ToolDefinition
	PollTask    ToolDefinition
	SelectAsset ToolDefinition
}{
	ListModels:  ToolDefinition{Name: "list_generation_models", Title: "列出生成模型", Description: "返回 MediaGo Drama 当前可用的生成模型目录、routeId、参数 schema、供应商配置状态和内置风格 preset（stylePresets，含预览图 previewUrl 与 promptSuffix）。", ReadOnly: true},
	Generate:    ToolDefinition{Name: "generate_media", Title: "提交媒体生成", Description: "提交图片、视频、音频或文本生成请求；prompt 必填，kind 默认 image，routeId/model/params 应来自 list_generation_models。"},
	GetTask:     ToolDefinition{Name: "get_generation_task", Title: "读取生成任务", Description: "按 taskId 读取生成任务的状态、结果资产、错误信息和尝试记录。", ReadOnly: true},
	ListTasks:   ToolDefinition{Name: "list_generation_tasks", Title: "列出生成任务", Description: "按 projectId、sessionId、kind、limit、offset 列出生成任务。", ReadOnly: true},
	RetryTask:   ToolDefinition{Name: "retry_generation_task", Title: "重试生成任务", Description: "按 taskId 重新提交失败或可重试的生成任务。"},
	PollTask:    ToolDefinition{Name: "poll_generation_task", Title: "轮询生成任务", Description: "按 taskId 轮询异步生成任务并同步最新状态。"},
	SelectAsset: ToolDefinition{Name: "select_generation_asset", Title: "选定生成结果", Description: "按 taskId + slotIndex 把某张生成结果标记为选中（用户选片后调用），返回更新后的任务。"},
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
		Description: "向用户展示一组可视化选项（如风格推荐网格）并阻塞等待其选择：返回所选 optionId（selected）、自定义描述（custom）、取消（cancelled）或超时（timeout）。options 必填，每项含 id/label，可带 imageUrl/description（自然语言，不要暴露内部字段名）。返回 timeout 时用 await_user_selection 对同一 selectionId 继续等待，不要重新弹卡。",
	},
	AskUserForm: ToolDefinition{
		Name:        "ask_user_form",
		Title:       "请用户填写表单",
		Description: "向用户展示一张参数表单卡并阻塞等待提交：fields 定义 select/toggle/number/text 字段（select 需给 options，默认值用 default 预填），提交后返回 status=submitted 与 values（字段 ID→值）。适合生成参数确认等多参数场景；单选场景用 ask_user_selection。返回 timeout 时用 await_user_selection 对同一 selectionId 续等。",
	},
	AwaitUserSelection: ToolDefinition{
		Name:        "await_user_selection",
		Title:       "继续等待用户选择",
		Description: "继续阻塞等待一张已存在的选择卡（不新建卡片）：传入 ask_user_selection 返回的 selectionId，返回值与 ask_user_selection 相同。用于把长等待拆成多轮 ≤90 秒的短等待，避免客户端工具超时；建议循环 3-5 轮后再改为在对话中询问。",
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
