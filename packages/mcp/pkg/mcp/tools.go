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
- 本 MCP 只提供 load_skill、get_project_config、update_project_config、list_comments、get_comment、mutate_comment。
- update_project_config 当前仅用于更新 overview.categoryDefaults；style 风格分类会被忽略。`

// ExternalMCPInstructions describes the cross-project MCP server contract.
const ExternalMCPInstructions = mcpWorkflowInstructions + `
- 本 MCP 只提供 list_projects、load_skill、get_project_config、list_comments、get_comment、mutate_comment。
- external cross-project server 的 get_project_config 和评论工具参数必须携带 projectId。`

// GenerationMCPInstructions describes the generation MCP server contract.
const GenerationMCPInstructions = `MediaGo Drama Generation MCP 使用说明：
- 本 MCP 只提供 MediaGo Drama 生成工作台能力，不提供文档正文读写。
- 生成图片/视频/音频/文本前优先调用 list_generation_models，确认 routeId、model、params 和 configured 状态。
- generate_media 用于提交生成请求；kind 默认 image。prompt 必填，routeId/model/params 应来自模型目录或用户明确输入。
- referenceUrls/referenceAssetIds/referenceBindings 可用于传入参考图、参考素材或文档绑定。
- get_generation_task / list_generation_tasks 用于查询任务状态和结果资产。
- poll_generation_task 用于轮询需要供应商查询的异步任务；retry_generation_task 用于重试失败或可重试任务。`

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
	ListModels ToolDefinition
	Generate   ToolDefinition
	GetTask    ToolDefinition
	ListTasks  ToolDefinition
	RetryTask  ToolDefinition
	PollTask   ToolDefinition
}{
	ListModels: ToolDefinition{Name: "list_generation_models", Title: "列出生成模型", Description: "返回 MediaGo Drama 当前可用的生成模型目录、routeId、参数 schema 和供应商配置状态。", ReadOnly: true},
	Generate:   ToolDefinition{Name: "generate_media", Title: "提交媒体生成", Description: "提交图片、视频、音频或文本生成请求；prompt 必填，kind 默认 image，routeId/model/params 应来自 list_generation_models。"},
	GetTask:    ToolDefinition{Name: "get_generation_task", Title: "读取生成任务", Description: "按 taskId 读取生成任务的状态、结果资产、错误信息和尝试记录。", ReadOnly: true},
	ListTasks:  ToolDefinition{Name: "list_generation_tasks", Title: "列出生成任务", Description: "按 projectId、sessionId、kind、limit、offset 列出生成任务。", ReadOnly: true},
	RetryTask:  ToolDefinition{Name: "retry_generation_task", Title: "重试生成任务", Description: "按 taskId 重新提交失败或可重试的生成任务。"},
	PollTask:   ToolDefinition{Name: "poll_generation_task", Title: "轮询生成任务", Description: "按 taskId 轮询异步生成任务并同步最新状态。"},
}

// AgentDocumentTools is the public run-scoped MCP surface exposed to agents.
var AgentDocumentTools = struct {
	LoadSkill           ToolDefinition
	GetProjectConfig    ToolDefinition
	UpdateProjectConfig ToolDefinition
	ListComments        ToolDefinition
	GetComment          ToolDefinition
	MutateComment       ToolDefinition
}{
	LoadSkill: ToolDefinition{
		Name:        DocumentTools.LoadSkill.Name,
		Title:       DocumentTools.LoadSkill.Title,
		Description: publicMCPBoundaryDescription + " " + DocumentTools.LoadSkill.Description,
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
