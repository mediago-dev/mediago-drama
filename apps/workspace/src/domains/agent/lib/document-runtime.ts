import {
	createDocumentOperation,
	createTextAnchor,
	type DocumentOperation,
} from "@/domains/documents/lib/operations";
import { toAgentDocumentSnapshot } from "@/domains/agent/api/agent";
import httpClient from "@/shared/lib/http";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import type { DocumentComment, MarkdownDocument } from "@/domains/documents/stores";
import { useProjectStore } from "@/domains/projects/stores";
import { sleep } from "@/shared/lib/utils";

export interface DocumentAgentRequest {
	prompt: string;
	document: MarkdownDocument;
	anchorText?: string;
	selectionText?: string;
	comments: DocumentComment[];
	commentId?: string;
}

export interface DocumentAgentResult {
	message: string;
	summary: string;
	operations: DocumentOperation[];
	runtime: DocumentAgentRuntimeMetadata;
}

export interface DocumentAgentRuntimeMetadata {
	runtime: "acp" | "mock" | "frontend-mock";
	fallback: boolean;
	validated: boolean;
	diagnostic?: string;
}

export const runDocumentAgent = async (
	request: DocumentAgentRequest,
): Promise<DocumentAgentResult> => {
	return runRemoteJsonDocumentAgent(request);
};

export const testDocumentAgentRuntime = async () => {
	const projectId = useProjectStore.getState().activeProjectId;
	if (!projectId) throw new Error("projectId is required");
	const response = await httpClient.post<DocumentAgentResult>(
		`/projects/${encodeURIComponent(projectId)}/agent/document-operations/test`,
	);
	return response.data;
};

export const getDocumentAgentRuntimeMode = () => {
	return useAgentPersistenceStore.getState().documentRuntimeMode;
};

export const setDocumentAgentRuntimeMode = (mode: "mock" | "remote") => {
	useAgentPersistenceStore.getState().setDocumentRuntimeMode(mode);
};

export const runMockDocumentAgent = async (
	request: DocumentAgentRequest,
	runtime: DocumentAgentRuntimeMetadata = {
		runtime: "frontend-mock",
		fallback: false,
		validated: true,
	},
): Promise<DocumentAgentResult> => {
	await sleep(350);

	const prompt = request.prompt.trim();
	const normalizedPrompt = prompt.toLowerCase();
	const targetComment = request.commentId
		? request.comments.find((comment) => comment.id === request.commentId)
		: undefined;
	const activeComment = targetComment ?? request.comments.find((comment) => !comment.resolved);

	if (request.selectionText && shouldRewriteSelection(normalizedPrompt)) {
		const replacement = rewriteSelection(request.selectionText, prompt, activeComment);
		return {
			message: "已根据选中文本生成改写，并直接更新到当前文档。",
			summary: "已改写选中的文档段落。",
			runtime,
			operations: [
				createDocumentOperation<DocumentOperation>({
					type: "replace_text",
					summary: "已改写选中文本。",
					target: {
						anchor: createTextAnchor(request.document.content, request.selectionText),
					},
					payload: { replacement },
				}),
			],
		};
	}

	if (activeComment && mentionsComment(normalizedPrompt)) {
		const replacement = rewriteSelection(activeComment.anchorText, prompt, activeComment);
		return {
			message: "已按未解决批注修改对应段落。",
			summary: "已按当前批注修改文档。",
			runtime,
			operations: [
				createDocumentOperation<DocumentOperation>({
					type: "replace_text",
					summary: "已把批注意见应用到锚定文本。",
					target: {
						anchor: activeComment.anchor,
					},
					payload: { replacement },
				}),
			],
		};
	}

	const block = createInsertBlock(prompt, normalizedPrompt, request.document.title);

	return {
		message: "已把生成结果插入当前文档，聊天区只保留操作回执。",
		summary: block.summary,
		runtime,
		operations: [
			createDocumentOperation<DocumentOperation>({
				type: "insert_markdown",
				summary: block.summary,
				target: {
					position: "append",
				},
				payload: {
					markdown: block.markdown,
				},
			}),
		],
	};
};

const shouldRewriteSelection = (prompt: string) =>
	["改", "重写", "润色", "更", "悬疑", "压迫", "紧张", "rewrite", "revise"].some((keyword) =>
		prompt.includes(keyword),
	);

const mentionsComment = (prompt: string) =>
	["评论", "批注", "反馈", "comment", "annotation"].some((keyword) => prompt.includes(keyword));

const rewriteSelection = (text: string, prompt: string, comment?: DocumentComment) => {
	const direction = comment?.body || prompt || "增强悬疑感";
	const trimmedText = text.trim();
	const cue = direction.includes("压迫") ? "压迫感" : "悬疑感";

	return `${trimmedText}。为了加强${cue}，她停住脚步，意识到这不是偶然的回声：刚刚被她碰过的控制台亮起一格微弱红光，广播里的杂音像是在吞咽，随后精准地重复了她心里没有说出口的问题。`;
};

const createInsertBlock = (prompt: string, normalizedPrompt: string, documentTitle: string) => {
	if (includesAny(normalizedPrompt, ["女主", "主角", "角色", "character"])) {
		return {
			summary: "已插入角色外观设定。",
			markdown: `## 角色｜林雾

**形象定位**：三十岁左右女性，城市悬疑题材女主，冷静调查者形象。

**面部特征**：鹅蛋脸，浅麦色肤色，黑色齐肩短发，眼神冷静警觉。

**身材气质**：中等身高，身形清瘦，肩背挺直，行动克制利落。

**着装造型**：深色风衣，灰黑内搭，磨旧牛仔裤，低调实用的调查者造型。

**标志性细节**：旧相机斜挎在身侧，右手银色戒指，随身黑色录音笔。`,
		};
	}

	if (includesAny(normalizedPrompt, ["废弃工厂", "场景", "空间", "scene", "factory"])) {
		return {
			summary: "已插入场景设定。",
			markdown: `## 场景提取清单

1. 废弃临海旧厂房 | 阴冷压抑 | 冷蓝灰与锈红

## 废弃临海旧厂房

**画幅构图**：横向 16:9 电影级场景设定图，极高画质，纯净无人的空间。

**视觉风格**：冷峻现实主义电影质感，潮湿工业废墟美术，极致细节。

**环境类型**：海边废弃工业厂房，包含装配大厅、地下仓库、控制室与狭窄通道。

**时间时刻**：深夜暴雨后，破损天窗漏入冷色月光，远处海雾压低能见度。

**空间氛围**：压抑、阴冷、危险感强，空旷大厅带有被长期封存的荒废气息。

**主要特征**：前景是积水地面与锈蚀传送带，中景有半开的资料柜、断裂梁柱、编号 03:17 的巡检表，后景是控制室碎玻璃与褪色墙面标语。

**Prompt (直接复制)**：不能出现其他人, 无人, 纯场景, 深夜暴雨后的废弃临海旧厂房，冷色月光从破损天窗落入空旷装配大厅，积水地面反射锈蚀传送带、断裂梁柱、半开的资料柜、编号 03:17 的巡检表，远处控制室碎玻璃与褪色墙面标语隐在海雾中，压抑阴冷的工业废墟氛围，横向16:9电影级场景设定图，极高画质，极致细节，no humans, empty, landscape only`,
		};
	}

	if (includesAny(normalizedPrompt, ["分镜", "镜头", "shot", "storyboard"])) {
		return {
			summary: "已插入分镜卡片。",
			markdown: `## 第 01 组 总时长：00:10

### 分镜｜工厂广播

\`\`\`video
start: 0
end: 10
visual: 林雾靠近控制台，手电光照到一排旧磁带标签，其中一盘写着她父亲的名字。
audio: 广播电流声忽然降低，像有人把麦克风贴近嘴边。
\`\`\`

## 第 02 组 总时长：00:12

### 分镜｜名字回响

\`\`\`video
start: 0
end: 12
visual: 她回头看向空荡大厅，远处二层走廊的红色指示灯依次亮起。
audio: 广播用失真的女声念出“林雾”，随后只剩海浪声。
\`\`\``,
		};
	}

	if (includesAny(normalizedPrompt, ["分级", "审核", "评级", "适龄", "rating", "classification"])) {
		return {
			summary: "已插入内容分级备注。",
			markdown: `## 内容分级｜当前剧本

- 悬疑强度：中高，主要来自未知广播、封闭空间和失踪线索。
- 恐怖元素：轻度到中度，当前没有直接血腥画面，适合用声音和空间压迫制造不安。
- 暴力风险：低，若后续加入事故回放，需要避免直接展示创伤细节。
- 语言风险：低，台词以调查和惊悚氛围为主。
- 适龄建议：建议按 13+ 到 16+ 方向控制，重点标注悬疑惊吓和心理压迫。
- 平台注意：封面和预告避免使用过度恐怖符号，物料描述强调悬疑调查而不是惊吓猎奇。`,
		};
	}

	if (includesAny(normalizedPrompt, ["台词", "对白", "dialogue", "字幕", "subtitle"])) {
		return {
			summary: "已插入台词和字幕节拍。",
			markdown: `## 台词｜工厂广播段

- 林雾：这里不该还有电。
- 广播：林雾，别打开第三个柜子。
- 林雾：你是谁？你怎么知道我的名字？
- 广播：你父亲也问过同样的问题。

## 字幕

- 这里不该还有电。
- 别打开第三个柜子。
- 你父亲也问过同样的问题。`,
		};
	}

	if (includesAny(normalizedPrompt, ["旁白", "voiceover", "vo", "解说"])) {
		return {
			summary: "已插入旁白文案。",
			markdown: `## 旁白｜进入工厂

她以为自己是在寻找一盘录像带。可当工厂的广播念出她的名字时，她终于明白：父亲留下的不是证据，而是一条等待她亲自走进来的路线。

## 旁白｜发现线索

每一处锈迹都像被时间故意保留下来，每一声电流都像有人在墙后呼吸。镜头记录了空间，却无法解释空间为什么正在回应她。`,
		};
	}

	if (includesAny(normalizedPrompt, ["音乐", "音效", "music", "sound"])) {
		return {
			summary: "已插入音乐和音效备注。",
			markdown: `## 音乐建议｜工厂段落

- 开场：低频脉冲保持在背景，不进入旋律。
- 名字出现：加入一次反向钢琴音，随后立即抽空。
- 发现录像带：用细碎金属摩擦声替代传统惊吓音。

## 音效

- 广播底噪需要有方向感，像从大厅深处移动到角色身后。
- 每次手电扫过水面时加入极轻的电流跳动声。`,
		};
	}

	if (includesAny(normalizedPrompt, ["剪辑备注", "备注", "note", "edit note"])) {
		return {
			summary: "已插入剪辑备注。",
			markdown: `## 剪辑备注｜工厂段落

- 进入工厂前保持镜头时间偏长，让观众先建立空间不安。
- 广播第一次出现时不要切反应镜头，先停留在空荡大厅。
- 名字被念出后用三个快速细节：红灯、磁带标签、林雾手指停住。
- 转入下一场前保留 1 秒黑场，只留海浪声。`,
		};
	}

	if (includesAny(normalizedPrompt, ["道具", "prop", "物件", "关键物件"])) {
		return {
			summary: "已插入道具设定。",
			markdown: `## DV 录像带

**剧情功能**：作为父亲失踪线索的实体证据，引导林雾进入废弃工厂深处。

**外观材质**：黑色塑料外壳，透明观察窗内可见磁带卷，边缘有细密划痕和潮气白斑。

**尺寸状态**：手掌大小，贴纸泛黄卷边，右上角有红色手写编号 03:17。

**使用方式**：角色从资料柜夹层取出，手电光扫过编号后触发下一段广播。

**关联角色/场景**：林雾持有；首次出现在废弃临海旧厂房控制室。

**连续性标记**：红色编号 03:17、泛黄标签、左下角缺口、潮湿磨损边缘。

**生成 Prompt**：黑色旧式 DV 录像带，泛黄手写标签，红色编号 03:17，透明观察窗，潮湿划痕，悬疑短剧关键道具特写，干净背景，高细节。`,
		};
	}

	if (includesAny(normalizedPrompt, ["素材", "asset", "美术"])) {
		return {
			summary: "已插入制作素材需求。",
			markdown: `## 素材需求｜工厂段落

- 场景素材：海边厂房外景、破损玻璃、积水地面、废弃传送带。
- 道具素材：DV 录像带、旧工牌、铁皮档案盒、手电筒、巡检表。
- 声音素材：广播底噪、金属回弹、远处海浪、空旷厂房混响。
- 音乐方向：低频脉冲铺底，名字出现时加入一次反向钢琴音。
- 剪辑备注：名字响起前保持长镜头，响起后切到三个快速细节镜头。`,
		};
	}

	return {
		summary: "已插入创作补充块。",
		markdown: `## 创作补充｜${documentTitle || "当前文档"}

- 指令：${prompt || "补充当前集内容"}
- 剧情推进：让角色在具体空间里发现一个能改变目标的证据。
- 场景调度：先用环境细节建立可信度，再用声音或物件制造异常。
- 镜头建议：一个建立空间关系的广角，一个观察角色反应的中近景，一个揭示线索的特写。
- 制作提醒：每段创作内容都保留可转换为场景、镜头、素材的结构。`,
	};
};

const includesAny = (value: string, keywords: string[]) =>
	keywords.some((keyword) => value.includes(keyword));

const runRemoteJsonDocumentAgent = async (request: DocumentAgentRequest) => {
	const projectId = useProjectStore.getState().activeProjectId;
	if (!projectId) throw new Error("projectId is required");
	const response = await httpClient.post<DocumentAgentResult>(
		`/projects/${encodeURIComponent(projectId)}/agent/document-operations`,
		{
			prompt: request.prompt,
			document: toAgentDocumentSnapshot(request.document),
			comments: request.comments,
			selectionText: request.selectionText,
			anchorText: request.anchorText,
			commentId: request.commentId,
		},
	);

	return response.data;
};
