import type { GenerationTask } from "@/domains/generation/api/generation";
import { generationStatusLabel } from "@/domains/generation/hooks/generationFormatters";

// 资源生成状态：把「某个文档分镜/资源」的若干生成任务，归约成一条可展示的状态。
// 内核与任意页面的数据形状无关——按 documentId + sectionId 匹配任务即可复用。
export type ResourceGenerationStatusKind = "pending" | "failed" | "completed";

export interface ResourceGenerationStatus {
	kind: ResourceGenerationStatusKind;
	label: string;
	message?: string;
	status: string;
	taskId: string;
	updatedAt?: string;
}

const failedGenerationStatuses = new Set(["failed", "error", "cancelled", "canceled"]);
const completedGenerationStatuses = new Set(["completed", "succeeded", "success"]);

export const resourceGenerationStatusKind = (status: string): ResourceGenerationStatusKind => {
	const normalized = status.toLowerCase().trim();
	if (failedGenerationStatuses.has(normalized)) return "failed";
	if (completedGenerationStatuses.has(normalized)) return "completed";
	return "pending";
};

export const isPendingGenerationStatus = (status: string) =>
	resourceGenerationStatusKind(status) === "pending";

export const hasPendingGenerationTasks = (tasks: GenerationTask[]) =>
	tasks.some((task) => isPendingGenerationStatus(task.status));

export const resourceGenerationStatusDisplayLabel = (kind: ResourceGenerationStatusKind) => {
	if (kind === "failed") return "生成失败";
	if (kind === "completed") return "已完成";
	return "生成中";
};

export const resourceGenerationStatusFromTask = (
	task: GenerationTask,
): ResourceGenerationStatus => {
	const kind = resourceGenerationStatusKind(task.status);
	return {
		kind,
		label: resourceGenerationStatusDisplayLabel(kind),
		message: task.error || task.message,
		status: task.status,
		taskId: task.id,
		updatedAt: task.updatedAt,
	};
};

export const generationTaskTime = (task: GenerationTask) => {
	const time = Date.parse(task.updatedAt || task.createdAt || "");
	return Number.isFinite(time) ? time : 0;
};

export const resourceGenerationStatusTime = (status: ResourceGenerationStatus) => {
	const time = Date.parse(status.updatedAt ?? "");
	return Number.isFinite(time) ? time : 0;
};

const latestGenerationTask = (tasks: GenerationTask[]) => {
	let latest: GenerationTask | undefined;
	let latestTime = Number.NEGATIVE_INFINITY;
	for (const task of tasks) {
		const time = generationTaskTime(task);
		if (!latest || time >= latestTime) {
			latest = task;
			latestTime = time;
		}
	}
	return latest;
};

const latestActiveOrRecentGenerationTask = (tasks: GenerationTask[]) =>
	latestGenerationTask(tasks.filter((task) => isPendingGenerationStatus(task.status))) ??
	latestGenerationTask(tasks);

// 在任务列表里找出匹配 (documentId, sectionId) 的最新一条，优先 pending。
export const generationStatusForSection = (
	tasks: GenerationTask[],
	documentId: string,
	sectionId: string,
) => {
	const matchingTasks = tasks.filter(
		(task) =>
			task.documentId?.trim() === documentId.trim() && task.sectionId?.trim() === sectionId.trim(),
	);
	const task = latestActiveOrRecentGenerationTask(matchingTasks);
	return task ? resourceGenerationStatusFromTask(task) : undefined;
};

// 合并：服务端任务派生的状态 ⊕ 乐观状态（同一资源取更新时间更晚者）。
export const mergeResourceGenerationStatusMaps = (
	taskStatuses: Map<string, ResourceGenerationStatus>,
	optimisticStatuses: Map<string, ResourceGenerationStatus>,
) => {
	const next = new Map(taskStatuses);
	for (const [resourceId, optimisticStatus] of optimisticStatuses) {
		const taskStatus = next.get(resourceId);
		if (
			!taskStatus ||
			resourceGenerationStatusTime(optimisticStatus) > resourceGenerationStatusTime(taskStatus)
		) {
			next.set(resourceId, optimisticStatus);
		}
	}
	return next;
};

// 列表上只需要展示「未完成」的状态（生成中/失败）；已完成的让结果本身透出。
export const visibleResourceGenerationStatus = (status?: ResourceGenerationStatus) =>
	status && status.kind !== "completed" ? status : undefined;

export const resourceGenerationStatusTitle = (status: ResourceGenerationStatus) => {
	const details = [generationStatusLabel(status.status)];
	if (status.message?.trim()) details.push(status.message.trim());
	return details.join(" · ");
};

export const resourceGenerationStatusBadgeClassName = (kind: ResourceGenerationStatusKind) => {
	if (kind === "failed") return "border-error-border bg-error-surface text-error-foreground";
	if (kind === "completed") {
		return "border-success-border bg-success-surface text-success-foreground";
	}
	return "border-info-border bg-info-surface text-info-foreground";
};

// 乐观状态构造器：列表行点「生成」后立刻置为生成中，无需等服务端。
export const pendingResourceGenerationStatus = (options: {
	taskId: string;
	message?: string;
	status?: string;
	updatedAt?: string;
}): ResourceGenerationStatus => ({
	kind: "pending",
	label: resourceGenerationStatusDisplayLabel("pending"),
	message: options.message,
	status: options.status ?? "submitted",
	taskId: options.taskId,
	updatedAt: options.updatedAt ?? new Date().toISOString(),
});

export const failedResourceGenerationStatus = (options: {
	taskId: string;
	message: string;
	updatedAt?: string;
}): ResourceGenerationStatus => ({
	kind: "failed",
	label: resourceGenerationStatusDisplayLabel("failed"),
	message: options.message,
	status: "failed",
	taskId: options.taskId,
	updatedAt: options.updatedAt ?? new Date().toISOString(),
});
