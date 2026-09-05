export interface ProjectRecoveryNoticeInput {
	hasTemplate: boolean;
	documentCount: number;
	documentResourcesError?: boolean;
	selectedAssetCount: number;
	generationTasks: Array<{
		status: string;
		error?: string | null;
		assets: unknown[];
	}>;
}

const PROJECT_RECOVERY_DISMISSAL_STORAGE_PREFIX = "project-recovery-dismissed.v1";

/** 同一个项目的同一批恢复问题只提醒一次；问题内容变化后会生成新的指纹。 */
export const projectRecoveryNoticeFingerprint = (notices: readonly string[]) =>
	notices
		.map((notice) => notice.trim())
		.filter(Boolean)
		.join("\n");

/** 关闭状态按项目隔离，避免关闭一个项目的提示后误伤其他项目。 */
export const projectRecoveryDismissalStorageKey = (projectId: string) =>
	`${PROJECT_RECOVERY_DISMISSAL_STORAGE_PREFIX}:${projectId.trim() || "unknown-project"}`;

/**
 * 把“项目还能不能继续做”需要看的异常，统一成口语化提示。
 * 这是纯函数，避免页面渲染逻辑变更时把恢复提示悄悄删掉。
 */
export const buildProjectRecoveryNotices = (input: ProjectRecoveryNoticeInput) => {
	const notices: string[] = [];
	if (!input.hasTemplate) {
		notices.push(
			input.documentCount > 0
				? "这个旧项目没有模板快照，但已有文档还在。你可以继续编辑旧文档；新阶段不会自动覆盖旧内容。"
				: "这个项目没有模板快照和阶段定义。先补充项目模板或直接使用项目总控，不会删除已有数据。",
		);
	}
	if (input.documentResourcesError) {
		notices.push("资产清单读取失败。原始文件不会因此删除，稍后刷新或从资产库重新载入。");
	}
	const failedTasks = input.generationTasks.filter(
		(task) =>
			["failed", "error", "cancelled"].includes(task.status.toLowerCase()) || Boolean(task.error),
	);
	const emptyCompletedTasks = input.generationTasks.filter(
		(task) =>
			["completed", "success", "succeeded"].includes(task.status.toLowerCase()) &&
			task.assets.length === 0,
	);
	if (failedTasks.length > 0) {
		notices.push(
			`有 ${failedTasks.length} 个生成任务失败，先在“生成任务中心”按“失败待处理”筛出原因，不要直接重跑全部任务。`,
		);
	}
	if (emptyCompletedTasks.length > 0) {
		notices.push(
			`有 ${emptyCompletedTasks.length} 个任务显示完成但没有结果文件，可能是外部路径失效；原任务记录仍保留，可重新导入或替换。`,
		);
	}
	if (input.selectedAssetCount === 0 && input.generationTasks.length > 0) {
		notices.push(
			"当前没有可供镜头调用的资产。生成结果如果不在资产库，请使用外部导入把文件放回项目关系链。",
		);
	}
	return notices;
};
