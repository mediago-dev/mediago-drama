import {
	runMockDocumentAgent,
	type DocumentAgentResult,
} from "@/domains/agent/lib/document-runtime";
import {
	applyDocumentOperationsToDocument,
	createDocumentOperation,
	createTextAnchor,
	type DocumentOperation,
	type OperationDocumentLike,
} from "@/domains/documents/lib/operations";
import { extractProductionBoard, getProductionItemCount } from "@/domains/episode/lib/production";
import type { DocumentComment, MarkdownDocument } from "@/domains/documents/stores";

export type DocumentSmokeStepStatus = "passed" | "failed";

export interface DocumentSmokeStep {
	label: string;
	status: DocumentSmokeStepStatus;
	detail: string;
}

export interface DocumentSmokeMetrics {
	operationsApplied: number;
	comments: number;
	characters: number;
	scenes: number;
	shots: number;
	assets: number;
	extractedItems: number;
}

export interface DocumentSmokeResult {
	ok: boolean;
	documentTitle: string;
	steps: DocumentSmokeStep[];
	metrics: DocumentSmokeMetrics;
}

export const runDocumentSmoke = async (): Promise<DocumentSmokeResult> => {
	let document = createSmokeDocument();
	let operationsApplied = 0;
	const steps: DocumentSmokeStep[] = [];

	const record = (label: string, passed: boolean, detail: string) => {
		steps.push({
			label,
			status: passed ? "passed" : "failed",
			detail,
		});
		return passed;
	};

	const apply = (label: string, result: Pick<DocumentAgentResult, "operations" | "summary">) => {
		const applied = applySmokeOperations(document, result.operations);
		document = applied.document;
		operationsApplied += applied.applied;
		return record(
			label,
			applied.applied > 0,
			`${result.summary} · 已应用 ${applied.applied} 个操作`,
		);
	};

	try {
		const characterResult = await runMockDocumentAgent({
			prompt: "帮我生成女主角色设定",
			document,
			comments: document.comments,
		});
		apply("智能体插入角色内容", characterResult);

		const sceneResult = await runMockDocumentAgent({
			prompt: "帮我生成一个废弃工厂的场景设定",
			document,
			comments: document.comments,
		});
		apply("智能体插入场景内容", sceneResult);

		const commentOperation = createDocumentOperation<DocumentOperation>({
			type: "add_comment",
			summary: "用户新增锚定的悬疑反馈。",
			target: {
				anchor: createTextAnchor(document.content, smokeAnchorText),
			},
			payload: {
				body: "这里要让广播像在回应她刚做过的动作。",
			},
		});
		const commentApplied = applySmokeOperations(document, [commentOperation]);
		document = commentApplied.document;
		operationsApplied += commentApplied.applied;
		record(
			"用户新增锚定批注",
			commentApplied.applied === 1 && document.comments.length === 1,
			`草稿中有 ${document.comments.length} 条批注`,
		);

		const comment = document.comments[0];
		if (!comment) {
			throw new Error("批注操作没有创建锚定批注。");
		}

		const rewriteResult = await runMockDocumentAgent({
			prompt: "根据这条批注把这段改得更有悬疑感",
			document,
			comments: document.comments,
			commentId: comment.id,
		});
		apply("智能体根据批注意见改写", rewriteResult);
		record(
			"批注意见已修改源文本",
			document.content.includes("为了加强悬疑感"),
			"锚定段落已包含悬疑改写。",
		);

		const shotsResult = await runMockDocumentAgent({
			prompt: "帮我生成两个分镜和镜头描述",
			document,
			comments: document.comments,
		});
		apply("智能体插入分镜卡片", shotsResult);

		const assetsResult = await runMockDocumentAgent({
			prompt: "整理这一段的素材需求",
			document,
			comments: document.comments,
		});
		apply("智能体插入制作素材", assetsResult);
	} catch (err) {
		record("冒烟测试运行完成", false, err instanceof Error ? err.message : "未知错误");
	}

	const board = extractProductionBoard(document);
	const metrics: DocumentSmokeMetrics = {
		operationsApplied,
		comments: document.comments.length,
		characters: board.characters.length,
		scenes: board.scenes.length,
		shots: board.shots.length,
		assets: board.assets.length,
		extractedItems: getProductionItemCount(board),
	};

	record(
		"文档转换为制作看板",
		metrics.characters > 0 && metrics.scenes > 0 && metrics.shots > 0 && metrics.assets > 0,
		`已提取 ${metrics.extractedItems} 个制作项`,
	);

	return {
		ok: steps.every((step) => step.status === "passed"),
		documentTitle: document.title,
		steps,
		metrics,
	};
};

const smokeAnchorText = "林雾推开工厂侧门，手电光扫过积水。";

const createSmokeDocument = (): MarkdownDocument => ({
	id: "smoke-doc-episode-one",
	title: "Smoke：第一集文档闭环",
	parentId: null,
	sortOrder: 0,
	version: 1,
	content: `# Smoke：第一集文档闭环

## 剧情

${smokeAnchorText}她以为这里只剩下锈蚀机器，却在夜班广播里听见自己的名字。
`,
	updatedAt: new Date().toISOString(),
	isDirty: false,
	comments: [],
	workbenchDraft: null,
});

const applySmokeOperations = (document: MarkdownDocument, operations: DocumentOperation[]) => {
	const result = applyDocumentOperationsToDocument(toOperationDocument(document), operations);

	return {
		applied: result.applied,
		document: {
			...document,
			title: result.document.title,
			content: result.document.content,
			comments: result.document.comments as DocumentComment[],
			version: document.version + 1,
			updatedAt: new Date().toISOString(),
			isDirty: result.applied > 0,
		},
	};
};

const toOperationDocument = (document: MarkdownDocument): OperationDocumentLike => ({
	title: document.title,
	content: document.content,
	comments: document.comments,
});
