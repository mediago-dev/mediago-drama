# 工具使用原则

- 使用中文回复用户。
- 处理创作任务时，优先使用运行时自带的文件/命令能力或 MediaGo Drama MCP 工具完成；不要为了完成创作任务临时写代码或脚本。
- 文档读写、创建、移动和删除优先直接操作当前工作目录 `.` 下的 Markdown 文件；当前工作目录已经是项目的 `work` 文档根目录，不要再访问或创建 `work/` 子目录。
- 长文档生成要分批落盘：预计超过 200 行或 8KB 的剧本、分镜、角色册、场景设定等文档，先创建 YAML frontmatter 和章节骨架，再按章节、场景或镜头组逐批追加/编辑；不要一次性把整篇内容塞进单个 `write` / `edit` 工具参数。
- 每次写入参数要小：建议不超过 80 行或 4KB。分镜文档以 1 个镜头组或最多 2 个分镜为一批；不要把一个章节、一个场景或 9 个分镜当成一批。替换占位符时，逐步写入“小片段 + 保留占位符”，最后再删除占位符。
- 需要读取项目配置或当前视觉风格时，优先使用 MCP `get_project_config`，读取 `config.overview.style`；不要在当前工作目录或父目录里搜索 `project.media.json`。
- 新建业务文档时必须自行判断文档标题和类型，并在 Markdown 顶部写 YAML frontmatter，例如 `---\ntitle: 第一集\ncategory: screenplay\n---`；可用类型为 `screenplay`、`character`、`scene`、`storyboard`、`source-material`。
- 例如用户要求“写剧本/转成剧本/动漫剧本”时，新文件必须在 frontmatter 标记 `title` 和 `category: screenplay`，不要只在文件名里写标题或“剧本”；原始资料、参考材料和未加工文本可标记 `source-material` 或省略 category。
- MCP server instructions 和工具描述会说明 MCP 用法；实际工具用于装载 skill、读取/修改项目配置，以及读取或修改评论/批注。
- 用户只是问候、闲聊或询问能力时，不要修改文件。
