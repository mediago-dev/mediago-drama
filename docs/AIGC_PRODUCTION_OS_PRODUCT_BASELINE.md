# AIGC Production OS｜产品开发基线

本文件将爱马仕项目 01–10 制作对话、参考图反推与迁移资料，以及 MediaGo Drama 现有能力整理为同一套 App 范围。现阶段目标是本地单机可用，UI 优化、插件、MCP、云同步和多人协作后置。

## 产品定位

一个运行于 macOS Intel 的本地 AIGC 制作管理 App，负责项目、文档、资产、镜头、版本、提示词、生成任务、连续性和 QC。爱马仕流程是第一套 Mother Template，软件底层保持项目类型无关。

## 核心对象

- PROJECT：项目目标、模板、规格和交付要求。
- STAGE：01–10 制作阶段、状态和通过条件。
- ASSET：角色、场景、产品、道具、特效和声音资产。
- SHOT：镜头卡、引用资产、首尾帧、动作和动态版本。
- VERSION：版本号、来源、状态、修改原因和当前选中版本。
- QC：PASS、FIX、REGEN、MISSING。
- PROMPT：生图、动作、布景、灯光和图生视频提示词。
- OUTPUT：粗剪、成片和交付文件。

## 01–10 母流程

1. Story：Brief、创意概念、锁定脚本和 Hero Shot。
2. Shot Breakdown：画面需求、节奏和镜头清单。
3. Asset Breakdown：Visual Bible、角色、场景、产品、道具和提示词。
4. Asset Generation：标准资产、桥接资产和版本候选。
5. Asset QC：一致性、品牌规范、缺失项和 AI 痕迹。
6. Hero Frame：镜头资产调用、构图、首帧和尾帧。
7. Motion：动作、方向、连续性和动态版本。
8. Rough Cut QC：粗剪、补镜头、补资产和连续性检查。
9. Final：精修、声音、调色、字幕和最终输出。
10. Review：复盘并沉淀可复用模板、规则和提示词。

## 参考图反推与迁移

### 第一层：证据化拆解

只记录画面可见证据，分别处理动作、环境、道具、构图、灯光、材质和氛围。每项保留置信度与未知项，低置信度推测不得进入正式生产提示词。

### 第二层：视觉迁移

把已确认的视觉关系分别映射到目标角色 Look、场景 Scene、道具 Prop 和产品 Product。人物身份、产品结构、品牌规范和项目连续性高于参考图；参考人物面孔、标识、文字和独特设计不可照搬。

### 输出

- 生图提示词
- 动作设计提示词
- 布景提示词
- 灯光提示词
- 动态图生视频提示词

## 当前可用版本

- 本地项目创建及 Commercial Film、Comic Drama、Short Film、Social Content、Mini Experiment、Custom 模板。
- 自动建立项目总控、故事、Visual Bible、角色库、场景库、道具产品库、参考迁移和镜头生产文档。
- Production OS 总览、阶段进度、门禁提示和镜头状态。
- 本地文档、资产、分镜、图片/视频生成工作区及媒体处理。
- 四步式参考图迁移工作台和五类结构化提示词。
- SQLite 与本地文件存储。
- Intel macOS x86_64 App、Go 本地服务、FFmpeg/FFprobe 和内置 Codex runtime。

## 下一开发批次

- 将阶段、资产、镜头、版本和 QC 从文档推导进一步升级为正式结构化数据。
- 参考图接入视觉模型，自动生成第一层证据候选，再由用户确认。
- 资产选择器直接向参考迁移模块提供 Look、Scene、Prop、Product ID。
- 阶段 PASS/FIX/REGEN/MISSING 操作与下游门禁联动。
- 用真实项目完成创建、资产登记、镜头制作、粗剪和输出的端到端验收。

## 后置范围

- UI 视觉精修与交互细节统一。
- MCP、Codex 插件和 ChatGPT 插件。
- Remote MCP、云同步、账号体系和多人协作。
- 自动更新、Developer ID 正式签名与 Apple 公证。
