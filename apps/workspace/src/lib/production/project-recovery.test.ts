import { describe, expect, it } from "vitest";
import {
	buildProjectRecoveryNotices,
	projectRecoveryDismissalStorageKey,
	projectRecoveryNoticeFingerprint,
} from "./project-recovery";

describe("buildProjectRecoveryNotices", () => {
	it("为旧项目和异常任务提供可执行提示", () => {
		const notices = buildProjectRecoveryNotices({
			hasTemplate: false,
			documentCount: 2,
			documentResourcesError: true,
			selectedAssetCount: 0,
			generationTasks: [
				{ status: "failed", error: "provider timeout", assets: [] },
				{ status: "completed", assets: [] },
			],
		});
		expect(notices).toHaveLength(5);
		expect(notices.join("\n")).toContain("旧项目没有模板快照");
		expect(notices.join("\n")).toContain("生成任务失败");
		expect(notices.join("\n")).toContain("没有结果文件");
	});

	it("没有异常时不显示恢复提示", () => {
		expect(
			buildProjectRecoveryNotices({
				hasTemplate: true,
				documentCount: 1,
				selectedAssetCount: 1,
				generationTasks: [{ status: "completed", assets: [{ id: "asset-1" }] }],
			}),
		).toEqual([]);
	});
});

describe("项目恢复提示关闭记录", () => {
	it("同一批提示生成稳定指纹，内容变化后指纹随之变化", () => {
		const notices = ["有 5 个生成任务失败", "资产清单读取失败"];
		expect(projectRecoveryNoticeFingerprint(notices)).toBe(
			projectRecoveryNoticeFingerprint([...notices]),
		);
		expect(projectRecoveryNoticeFingerprint(notices)).not.toBe(
			projectRecoveryNoticeFingerprint(["有 4 个生成任务失败", "资产清单读取失败"]),
		);
	});

	it("不同项目使用不同的关闭记录", () => {
		expect(projectRecoveryDismissalStorageKey("project-a")).not.toBe(
			projectRecoveryDismissalStorageKey("project-b"),
		);
	});
});
