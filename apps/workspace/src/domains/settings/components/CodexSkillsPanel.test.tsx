import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getCodexSkill,
	listCodexSkills,
	type CodexSkillDetail,
	type CodexSkillListItem,
	type CodexSkillsResponse,
} from "@/domains/settings/api/codex-skills";
import { revealNativePath } from "@/shared/desktop/actions";
import { isDesktopRuntime } from "@/shared/desktop/runtime";
import { CodexSkillsPanel } from "./CodexSkillsPanel";

vi.mock("@/domains/settings/api/codex-skills", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/domains/settings/api/codex-skills")>()),
	getCodexSkill: vi.fn(),
	listCodexSkills: vi.fn(),
}));

vi.mock("@/shared/desktop/actions", () => ({
	revealNativePath: vi.fn(),
}));

vi.mock("@/shared/desktop/runtime", () => ({
	isDesktopRuntime: vi.fn(),
}));

describe("CodexSkillsPanel", () => {
	beforeEach(() => {
		ensurePointerCaptureMocks();
		vi.clearAllMocks();
		vi.mocked(isDesktopRuntime).mockReturnValue(false);
		vi.mocked(revealNativePath).mockResolvedValue(undefined);
		vi.mocked(getCodexSkill).mockImplementation(async (id) =>
			detailFrom(allStateSkills.find((skill) => skill.id === id) ?? allStateSkills[0]),
		);
	});

	afterEach(() => {
		cleanup();
	});

	it("keeps the page frame visible while scanning", () => {
		vi.mocked(listCodexSkills).mockReturnValue(new Promise(() => {}));

		renderPanel();

		expect(screen.getByRole("heading", { name: "Codex 全局技能" })).toBeInTheDocument();
		expect(screen.getByLabelText("正在扫描 Codex 技能")).toBeInTheDocument();
		const liveStatus = screen.getByRole("status");
		expect(liveStatus).toHaveAttribute("aria-live", "polite");
		expect(liveStatus).toHaveTextContent("正在扫描 Codex 技能");
		expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);
	});

	it("shows canonical shared-directory guidance when no skills are found", async () => {
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([]));

		renderPanel();

		expect(await screen.findByText("尚未发现全局 Skill")).toBeInTheDocument();
		expect(screen.getByText("~/.agents/skills/<name>/SKILL.md")).toBeInTheDocument();
	});

	it("shows a fatal error and retries the inventory request", async () => {
		vi.mocked(listCodexSkills)
			.mockRejectedValueOnce(new Error("扫描服务不可用"))
			.mockResolvedValueOnce(inventory([]));

		renderPanel();

		expect(await screen.findByText("无法读取 Codex 技能")).toBeInTheDocument();
		expect(screen.getByText("扫描服务不可用")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));

		await waitFor(() => expect(listCodexSkills).toHaveBeenCalledTimes(2));
		expect(await screen.findByText("尚未发现全局 Skill")).toBeInTheDocument();
	});

	it("keeps partial root failures in a tooltip without rendering summary cards", async () => {
		const data = inventory(allStateSkills);
		data.summary = { total: 5, mediaGoAvailable: 1, needsAttention: 3, unknown: 1 };
		data.roots = [
			{
				source: "admin",
				displayPath: "/etc/codex/skills",
				exists: true,
				readable: false,
				mediaGoVisible: true,
				deprecated: false,
				error: "权限不足",
			},
		];
		data.issues = [
			{
				code: "root_unreadable",
				message: "无法读取管理员 Skill 目录",
				source: "admin",
				displayPath: "/etc/codex/skills",
			},
		];
		vi.mocked(listCodexSkills).mockResolvedValue(data);

		renderPanel();

		const sourceIssueIcon = await screen.findByLabelText("部分来源未能扫描，1 条");
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("总数 5")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("MediaGo 可用 1")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("需处理 3")).not.toBeInTheDocument();
		fireEvent.focus(sourceIssueIcon);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("部分来源未能扫描");
		expect(screen.getByRole("tooltip")).toHaveTextContent("无法读取管理员 Skill 目录");
	});

	it("searches and filters by diagnostic status and source", async () => {
		vi.mocked(listCodexSkills).mockResolvedValue(inventory(allStateSkills));

		renderPanel();

		expect(await screen.findByRole("button", { name: "Release Check，可用" })).toBeInTheDocument();
		fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Codex 技能" }), {
			target: { value: "legacy" },
		});
		expect(screen.getByRole("button", { name: "Legacy Skill，未共享" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Release Check，可用" })).not.toBeInTheDocument();
		await waitFor(() => expect(getCodexSkill).toHaveBeenCalledWith("legacy-skill"));

		fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Codex 技能" }), {
			target: { value: "" },
		});
		await selectFilterOption("诊断状态", "MediaGo 可用");
		expect(screen.getByRole("button", { name: "Release Check，可用" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Legacy Skill，未共享" })).not.toBeInTheDocument();

		await selectFilterOption("诊断状态", "全部状态");
		await selectFilterOption("Skill 来源", "系统");
		expect(screen.getByRole("button", { name: "System Skill，未确认" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Release Check，可用" })).not.toBeInTheDocument();
		await waitFor(() => expect(getCodexSkill).toHaveBeenCalledWith("system-skill"));
	});

	it("includes App/CLI-only problems in the attention filter", async () => {
		const available = allStateSkills[0];
		const hostDisabled: CodexSkillListItem = {
			...available,
			id: "host-disabled",
			displayName: "Host Disabled",
			name: "host-disabled",
			appCli: {
				state: "disabled",
				reasonCode: "disabled_by_config",
				message: "本机 Codex 配置已禁用此 Skill。",
			},
		};
		const data = inventory([available, hostDisabled]);
		data.summary.needsAttention = 1;
		vi.mocked(listCodexSkills).mockResolvedValue(data);

		renderPanel();

		expect(await screen.findByRole("button", { name: "Release Check，可用" })).toBeInTheDocument();
		expect(screen.queryByLabelText("需处理 1")).not.toBeInTheDocument();
		await selectFilterOption("诊断状态", "需处理");
		expect(screen.getByRole("button", { name: "Host Disabled，可用" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Release Check，可用" })).not.toBeInTheDocument();
	});

	it("matches every origin in the source filter and lists all origins in detail", async () => {
		const selected: CodexSkillListItem = {
			...allStateSkills[0],
			aliasCount: 2,
			origins: [
				{
					source: "user_shared",
					displayPath: "~/.agents/skills/release-check/SKILL.md",
					linked: false,
					deprecated: false,
				},
				{
					source: "codex_home",
					displayPath: "~/.codex/skills/release-check/SKILL.md",
					linked: true,
					deprecated: true,
				},
			],
		};
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([selected]));
		vi.mocked(getCodexSkill).mockResolvedValue(detailFrom(selected));

		renderPanel();
		await screen.findByTestId("codex-skill-raw");
		await selectFilterOption("Skill 来源", "Codex Home（兼容目录）");

		expect(screen.getByRole("button", { name: "Release Check，可用" })).toBeInTheDocument();
		const origins = screen.getByText("全部发现入口").closest("div");
		expect(origins).not.toBeNull();
		expect(
			within(origins as HTMLElement).getByText("~/.agents/skills/release-check/SKILL.md"),
		).toBeInTheDocument();
		expect(
			within(origins as HTMLElement).getByText("~/.codex/skills/release-check/SKILL.md"),
		).toBeInTheDocument();
		expect(within(origins as HTMLElement).getByText("符号链接")).toBeInTheDocument();
		expect(within(origins as HTMLElement).getByText("兼容来源")).toBeInTheDocument();
	});

	it("communicates every availability state with visible text", async () => {
		vi.mocked(listCodexSkills).mockResolvedValue(inventory(allStateSkills));

		renderPanel();

		expect(await screen.findByRole("button", { name: "Release Check，可用" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Disabled Skill，已禁用" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Legacy Skill，未共享" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Broken Skill，无效" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "System Skill，未确认" })).toBeInTheDocument();
	});

	it("keeps the inventory results in the lower scrollable region", async () => {
		vi.mocked(listCodexSkills).mockResolvedValue(inventory(allStateSkills));

		renderPanel();
		await screen.findByTestId("codex-skill-raw");

		expect(screen.getByTestId("codex-skill-results")).toHaveClass(
			"min-h-0",
			"flex-1",
			"overflow-hidden",
		);
		expect(screen.getByTestId("codex-skill-list")).toHaveClass(
			"h-full",
			"min-h-0",
			"overflow-y-auto",
		);
		expect(screen.getByTestId("codex-skill-detail")).toHaveClass("min-h-0", "overflow-y-auto");
	});

	it("loads a selected detail and renders SKILL.md as raw plaintext", async () => {
		const selected = allStateSkills[0];
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([selected]));
		vi.mocked(getCodexSkill).mockResolvedValue(
			detailFrom(selected, "---\nname: release-check\n---\n![remote](https://example.com/x.png)"),
		);

		renderPanel();

		const raw = await screen.findByTestId("codex-skill-raw");
		expect(raw.tagName).toBe("PRE");
		expect(raw).not.toHaveClass("max-h-96", "overflow-auto");
		expect(raw).toHaveTextContent("![remote](https://example.com/x.png)");
		expect(screen.queryByRole("img", { name: "remote" })).not.toBeInTheDocument();
		expect(getCodexSkill).toHaveBeenCalledWith(selected.id);
	});

	it("keeps an oversized valid skill available while explaining that preview was skipped", async () => {
		const selected = allStateSkills[0];
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([selected]));
		vi.mocked(getCodexSkill).mockResolvedValue({
			...detailFrom(selected, ""),
			previewAvailable: false,
			issues: [
				{
					code: "preview_unavailable",
					message: "SKILL.md 超过 256 KiB，未加载原始内容预览。",
					source: selected.source,
					displayPath: selected.displayPath,
				},
			],
		});

		renderPanel();

		expect(await screen.findByTestId("codex-skill-raw")).toHaveTextContent(
			"SKILL.md 超过 256 KiB，未加载原始内容预览。",
		);
		expect(screen.getByRole("button", { name: "Release Check，可用" })).toBeInTheDocument();
		expect(screen.getAllByText(/超过 256 KiB/)).toHaveLength(2);
	});

	it("uses neutral copy when an unavailable preview has no matching issue", async () => {
		const selected = allStateSkills[0];
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([selected]));
		vi.mocked(getCodexSkill).mockResolvedValue({
			...detailFrom(selected, ""),
			previewAvailable: false,
			issues: [],
		});

		renderPanel();

		const raw = await screen.findByTestId("codex-skill-raw");
		expect(raw).toHaveTextContent("原始 SKILL.md 预览不可用");
		expect(raw).not.toHaveTextContent("过大");
	});

	it("shows product restrictions as an explicit unknown diagnostic", async () => {
		const selected: CodexSkillListItem = {
			...allStateSkills[4],
			products: ["chatgpt"],
			mediaGo: {
				state: "unknown",
				reasonCode: "product_restricted",
				message: "该 Skill 未声明支持 Codex 产品。",
			},
		};
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([selected]));
		vi.mocked(getCodexSkill).mockResolvedValue(detailFrom(selected));

		renderPanel();

		expect(await screen.findByText("该 Skill 未声明支持 Codex 产品。")).toBeInTheDocument();
		expect(screen.getByText("限定产品")).toBeInTheDocument();
		expect(screen.getByText("chatgpt")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "System Skill，未确认" })).toBeInTheDocument();
	});

	it("rescans the inventory and current detail while exposing refresh progress", async () => {
		const selected = allStateSkills[0];
		const listRefresh = deferred<CodexSkillsResponse>();
		const detailRefresh = deferred<CodexSkillDetail>();
		vi.mocked(listCodexSkills)
			.mockResolvedValueOnce(inventory([selected]))
			.mockReturnValueOnce(listRefresh.promise);
		vi.mocked(getCodexSkill)
			.mockResolvedValueOnce(detailFrom(selected))
			.mockReturnValueOnce(detailRefresh.promise);

		renderPanel();
		await screen.findByTestId("codex-skill-raw");
		const refreshButton = screen.getByRole("button", { name: "重新扫描" });
		expect(refreshButton).toHaveAttribute("aria-busy", "false");
		fireEvent.click(refreshButton);

		await waitFor(() => expect(listCodexSkills).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(getCodexSkill).toHaveBeenCalledTimes(2));
		expect(refreshButton).toHaveAttribute("aria-busy", "true");
		expect(refreshButton).toBeDisabled();
		expect(screen.getByRole("status")).toHaveTextContent("正在重新扫描 Codex 技能");

		await act(async () => {
			listRefresh.resolve(inventory([selected]));
			detailRefresh.resolve(detailFrom(selected));
		});
		await waitFor(() => expect(refreshButton).toHaveAttribute("aria-busy", "false"));
	});

	it("warns about duplicate names and supports arrow-key row selection", async () => {
		const first = { ...allStateSkills[0], sameNameCount: 2 };
		const second = {
			...allStateSkills[1],
			id: "duplicate-release",
			name: first.name,
			displayName: "Release Check (Codex Home)",
			sameNameCount: 2,
		};
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([first, second]));

		renderPanel();

		const firstRow = await screen.findByRole("button", { name: /Release Check，/ });
		const secondRow = screen.getByRole("button", { name: /Release Check \(Codex Home\)，/ });
		expect(screen.getAllByText("同名 2 项")).toHaveLength(2);
		firstRow.focus();
		fireEvent.keyDown(firstRow, { key: "ArrowDown" });
		await waitFor(() => expect(secondRow).toHaveFocus());
		await waitFor(() => expect(getCodexSkill).toHaveBeenCalledWith(second.id));
	});

	it("does not reselect a stale detail from the old list while its recovery scan is pending", async () => {
		const selected = allStateSkills[0];
		const recoveryScan = deferred<CodexSkillsResponse>();
		const manualScan = deferred<CodexSkillsResponse>();
		vi.mocked(listCodexSkills)
			.mockResolvedValueOnce(inventory([selected]))
			.mockReturnValueOnce(recoveryScan.promise)
			.mockReturnValueOnce(manualScan.promise);
		vi.mocked(getCodexSkill)
			.mockRejectedValueOnce({ code: 404, message: "not found" })
			.mockResolvedValueOnce(detailFrom(selected));

		renderPanel();

		expect(await screen.findByText("该 Skill 已移动或删除，列表已重新扫描。")).toBeInTheDocument();
		await waitFor(() => expect(listCodexSkills).toHaveBeenCalledTimes(2));
		expect(getCodexSkill).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Release Check，可用" })).not.toHaveAttribute(
			"aria-current",
		);

		await act(async () => recoveryScan.resolve(inventory([selected])));
		await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("扫描完成"));
		expect(getCodexSkill).toHaveBeenCalledTimes(1);

		const selectedDetailCalls = () =>
			vi.mocked(getCodexSkill).mock.calls.filter(([id]) => id === selected.id).length;
		const callsBeforeManualScan = selectedDetailCalls();
		fireEvent.click(screen.getByRole("button", { name: "重新扫描" }));
		await waitFor(() => expect(listCodexSkills).toHaveBeenCalledTimes(3));
		expect(selectedDetailCalls()).toBe(callsBeforeManualScan);
		await act(async () => manualScan.resolve(inventory([selected])));
		await waitFor(() => expect(selectedDetailCalls()).toBeGreaterThan(callsBeforeManualScan));
	});

	it("shows reveal-in-file-manager only in the desktop runtime", async () => {
		vi.mocked(isDesktopRuntime).mockReturnValue(true);
		vi.mocked(listCodexSkills).mockResolvedValue(inventory([allStateSkills[0]]));

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "在文件管理器中显示" }));
		expect(revealNativePath).toHaveBeenCalledWith(detailFrom(allStateSkills[0]).absolutePath);

		cleanup();
		vi.mocked(isDesktopRuntime).mockReturnValue(false);
		renderPanel();
		await screen.findByText("Release Check");
		expect(screen.queryByRole("button", { name: "在文件管理器中显示" })).not.toBeInTheDocument();
	});
});

const renderPanel = () =>
	render(
		<SWRConfig
			value={{
				dedupingInterval: 0,
				provider: () => new Map(),
				shouldRetryOnError: false,
			}}
		>
			<CodexSkillsPanel />
		</SWRConfig>,
	);

const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
};

const selectFilterOption = async (label: string, optionName: string) => {
	fireEvent.pointerDown(screen.getByRole("combobox", { name: label }), {
		button: 0,
		ctrlKey: false,
		pageX: 0,
		pageY: 0,
		pointerId: 1,
		pointerType: "mouse",
	});
	fireEvent.click(await screen.findByRole("option", { name: optionName }));
};

const ensurePointerCaptureMocks = () => {
	const pointerCaptureMethods = {
		hasPointerCapture: () => false,
		releasePointerCapture: () => undefined,
		scrollIntoView: () => undefined,
		setPointerCapture: () => undefined,
	};

	for (const [methodName, implementation] of Object.entries(pointerCaptureMethods)) {
		if (methodName in HTMLElement.prototype) continue;
		Object.defineProperty(HTMLElement.prototype, methodName, {
			configurable: true,
			value: implementation,
		});
	}
};

const inventory = (skills: CodexSkillListItem[]): CodexSkillsResponse => ({
	generatedAt: "2026-07-14T12:00:00Z",
	issues: [],
	roots: [],
	skills,
	summary: {
		mediaGoAvailable: skills.filter((skill) => skill.mediaGo.state === "available").length,
		needsAttention: skills.filter((skill) =>
			[skill.appCli.state, skill.mediaGo.state].some((state) =>
				["disabled", "not_shared", "invalid"].includes(state),
			),
		).length,
		total: skills.length,
		unknown: skills.filter(
			(skill) => skill.appCli.state === "unknown" || skill.mediaGo.state === "unknown",
		).length,
	},
});

const detailFrom = (skill: CodexSkillListItem, rawContent = `---\nname: ${skill.name}\n---`) =>
	({
		...skill,
		absolutePath: `/Users/example/.agents/skills/${skill.id}/SKILL.md`,
		dependencies: [],
		issues: [],
		previewAvailable: true,
		rawContent,
	}) satisfies CodexSkillDetail;

const skill = (
	id: string,
	displayName: string,
	state: CodexSkillListItem["mediaGo"]["state"],
	source: CodexSkillListItem["source"],
): CodexSkillListItem => ({
	id,
	name: id,
	displayName,
	description: `${displayName} description`,
	source,
	displayPath: `~/.agents/skills/${id}/SKILL.md`,
	origins: [
		{
			source,
			displayPath: `~/.agents/skills/${id}/SKILL.md`,
			linked: false,
			deprecated: source === "codex_home",
		},
	],
	aliasCount: 1,
	deprecated: source === "codex_home",
	linked: false,
	valid: state !== "invalid",
	syntaxValidity: state === "invalid" ? "invalid" : "valid",
	sameNameCount: 1,
	samePhysicalCount: 1,
	appCli: {
		state: state === "not_shared" ? "available" : state,
		reasonCode: state === "invalid" ? "invalid_skill" : "user_shared",
		message: `App/CLI ${state}`,
	},
	mediaGo: {
		state,
		reasonCode:
			state === "disabled"
				? "disabled_by_config"
				: state === "not_shared"
					? "runtime_home_isolated"
					: state === "invalid"
						? "invalid_skill"
						: state === "unknown"
							? "runtime_home_unknown"
							: "user_shared",
		message: `MediaGo ${state}`,
	},
	allowImplicitInvocation: true,
	hasScripts: false,
	hasReferences: false,
	hasAssets: false,
	dependencyCount: 0,
});

const allStateSkills: CodexSkillListItem[] = [
	skill("release-check", "Release Check", "available", "user_shared"),
	skill("disabled-skill", "Disabled Skill", "disabled", "user_shared"),
	skill("legacy-skill", "Legacy Skill", "not_shared", "codex_home"),
	skill("broken-skill", "Broken Skill", "invalid", "admin"),
	skill("system-skill", "System Skill", "unknown", "system"),
];
