import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAgentSelection } from "@/domains/agent/api/agent";
import { type AgentMessage, useAgentStore } from "@/domains/agent/stores";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { useProjectStore } from "@/domains/projects/stores";
import { AgentFormCard } from "./AgentFormCard";

const mocks = vi.hoisted(() => ({
	agentFormGenerationSettings: vi.fn(),
	decideAgentPermission: vi.fn(),
	decideAgentSelection: vi.fn(),
	decideDocumentToolApproval: vi.fn(),
	generationSettingsRuntime: {
		busy: false,
		emitValue: true,
		valid: true,
		value: {
			kind: "image",
			label: "Seedream 5",
			params: { n: 1, ratio: "3:4", resolution: "2k" },
			promptOptimization: { enabled: false },
			promptSupplements: [],
			referenceAssetIds: ["asset-a"],
			routeId: "route-canonical",
		},
	},
	uploadMediaAsset: vi.fn(),
	useSWR: vi.fn(),
}));

vi.mock("@/domains/agent/api/agent", () => mocks);
vi.mock("@/domains/workspace/api/media", () => ({
	uploadMediaAsset: (...args: unknown[]) => mocks.uploadMediaAsset(...args),
}));
vi.mock("swr", () => ({ default: mocks.useSWR }));
vi.mock("./AgentFormGenerationSettings", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	return {
		AgentFormGenerationSettings: (props: {
			disabled: boolean;
			kind: "image" | "video";
			onBusyChange?: (busy: boolean) => void;
			onChange: (value: unknown) => void;
			onValidityChange?: (valid: boolean) => void;
			projectId?: string;
		}) => {
			const runtime = mocks.generationSettingsRuntime;
			mocks.agentFormGenerationSettings(props);
			React.useEffect(() => {
				if (runtime.emitValue) props.onChange(runtime.value);
				props.onBusyChange?.(runtime.busy);
				props.onValidityChange?.(runtime.valid);
			}, [props.onBusyChange, props.onChange, props.onValidityChange, runtime]);
			return (
				<div data-testid="shared-agent-generation-settings" data-project-id={props.projectId}>
					<span>共享生成五区块</span>
					<button
						type="button"
						onClick={() => {
							props.onBusyChange?.(true);
							props.onBusyChange?.(true);
						}}
					>
						重复上报忙碌
					</button>
					<button type="button" onClick={() => props.onBusyChange?.(false)}>
						上报空闲
					</button>
				</div>
			);
		},
	};
});

describe("AgentFormCard", () => {
	beforeEach(() => {
		// Default: no SWR data — the selection-status probe stays unresolved and
		// the catalog is absent unless a test overrides the mock.
		mocks.useSWR.mockImplementation(() => ({ data: undefined }));
		mocks.agentFormGenerationSettings.mockClear();
		mocks.generationSettingsRuntime = {
			busy: false,
			emitValue: true,
			valid: true,
			value: {
				kind: "image",
				label: "Seedream 5",
				params: { n: 1, ratio: "3:4", resolution: "2k" },
				promptOptimization: { enabled: false },
				promptSupplements: [],
				referenceAssetIds: ["asset-a"],
				routeId: "route-canonical",
			},
		};
	});
	afterEach(() => {
		cleanup();
		vi.mocked(decideAgentSelection).mockReset();
		mocks.useSWR.mockReset();
		useAgentStore.getState().resetSession();
		useProjectStore.setState({ activeProjectId: null });
		useAgentPersistenceStore.setState({ resolvedSelections: {} });
	});

	it("submits edited field values and freezes the card with a summary", async () => {
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-1",
			title: "确认生成参数",
			options: [],
			allowCustom: false,
			status: "submitted",
			decision: { values: { aspectRatio: "16:9", optimizePrompt: true, n: 2 } },
			createdAt: "2026-06-08T10:00:00.000Z",
		} as never);
		const message = formMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		expect(screen.getByText("确认生成参数")).toBeTruthy();
		fireEvent.click(screen.getByText("16:9 横版"));
		fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } });
		fireEvent.click(screen.getByText("确认生成"));

		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [selectionId, request, projectId] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect(selectionId).toBe("selection-1");
		expect(projectId).toBe("project-1");
		expect(request).toEqual({
			values: { aspectRatio: "16:9", optimizePrompt: true, n: 2 },
		});

		// The card freezes into a read-only summary; the confirm button is gone.
		await waitFor(() => expect(screen.getByText(/已提交：/)).toBeTruthy());
		expect(screen.getByText(/16:9 横版/)).toBeTruthy();
		expect(screen.queryByText("确认生成")).toBeNull();

		const resolved = useAgentPersistenceStore.getState().resolvedSelections["selection-1"];
		expect(resolved?.status).toBe("submitted");
		expect(resolved?.summary).toContain("16:9 横版");
	});

	it("cancels the form and freezes the card", async () => {
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-1",
			title: "确认生成参数",
			options: [],
			allowCustom: false,
			status: "cancelled",
			decision: { cancelled: true },
			createdAt: "2026-06-08T10:00:00.000Z",
		} as never);
		const message = formMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);
		fireEvent.click(screen.getByText("取消"));

		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [, request] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect(request).toEqual({ cancelled: true });
		await waitFor(() => expect(screen.getByText(/已取消/)).toBeTruthy());
		expect(useAgentPersistenceStore.getState().resolvedSelections["selection-1"]?.status).toBe(
			"cancelled",
		);
		expect(useAgentStore.getState().activity[0]?.label).toBe("参数已取消");
	});

	it("renders a generation_params field from the configured catalog and submits {routeId, params}", async () => {
		mocks.useSWR.mockImplementation((key: unknown) =>
			Array.isArray(key) && key[0] === "agent-selection-status"
				? { data: undefined }
				: { data: generationCatalog() },
		);
		vi.mocked(decideAgentSelection).mockImplementation(
			async (_selectionId: string, request: { values?: Record<string, unknown> }) =>
				({
					id: "selection-2",
					title: "确认生成参数",
					options: [],
					allowCustom: false,
					status: "submitted",
					decision: { values: request.values },
					createdAt: "2026-06-08T10:00:00.000Z",
				}) as never,
		);
		const message = generationFormMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		// Only configured families render; the default route comes from field.default.
		await waitFor(() => expect(screen.getByText("GPT Image")).toBeTruthy());
		expect(screen.queryByText(/DMX/)).toBeNull();

		fireEvent.click(screen.getByText("确认生成"));
		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [, request] = vi.mocked(decideAgentSelection).mock.calls[0];
		const submitted = (request as { values: Record<string, unknown> }).values.generation as Record<
			string,
			unknown
		>;
		expect(submitted.routeId).toBe("mediago.gpt-image-2");
		expect(submitted.label).toBe("MediaGo · GPT Image 2");
		expect(submitted.params).toEqual({ aspectRatio: "16:9", resolution: "4K", n: 2 });
	});

	it("submits one canonical generation_settings value and uses the effective project id", async () => {
		vi.mocked(decideAgentSelection).mockImplementation(
			async (_selectionId, request) =>
				({
					id: "selection-settings",
					title: "确认图片生成设置",
					options: [],
					allowCustom: false,
					status: "submitted",
					decision: { values: request.values },
					createdAt: "2026-07-15T00:00:00.000Z",
				}) as never,
		);
		const message = generationSettingsFormMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-active" });

		render(<AgentFormCard message={message} />);

		await waitFor(() => expect(screen.getByText("确认生成")).toBeEnabled());
		expect(screen.getByTestId("shared-agent-generation-settings")).toHaveAttribute(
			"data-project-id",
			"project-active",
		);
		expect(screen.queryByText("不应显示旧字段标签")).toBeNull();
		fireEvent.click(screen.getByText("确认生成"));

		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [selectionId, request, projectId] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect(selectionId).toBe("selection-settings");
		expect(projectId).toBe("project-active");
		expect(request).toEqual({
			values: { settings: mocks.generationSettingsRuntime.value },
		});
		await waitFor(() => expect(screen.getByText(/已提交：Seedream 5/)).toBeTruthy());
		expect(screen.getByText(/1 张参考图/)).toBeTruthy();
	});

	it("routes video generation_settings through the shared video form", async () => {
		const message = generationSettingsFormMessage();
		message.metadata!.form!.fields[0]!.kind = "video";
		message.metadata!.form!.fields[0]!.default = {
			...mocks.generationSettingsRuntime.value,
			kind: "video",
		};
		seedConversation(message);

		render(<AgentFormCard message={message} />);

		await waitFor(() => expect(mocks.agentFormGenerationSettings).toHaveBeenCalled());
		expect(mocks.agentFormGenerationSettings).toHaveBeenLastCalledWith(
			expect.objectContaining({ kind: "video" }),
		);
	});

	it("keeps confirm disabled while generation settings are not ready, but cancel remains actionable", async () => {
		mocks.generationSettingsRuntime = {
			...mocks.generationSettingsRuntime,
			busy: false,
			valid: false,
		};
		vi.mocked(decideAgentSelection).mockResolvedValue({
			id: "selection-settings",
			title: "确认图片生成设置",
			options: [],
			allowCustom: false,
			status: "cancelled",
			decision: { cancelled: true },
			createdAt: "2026-07-15T00:00:00.000Z",
		} as never);
		const message = generationSettingsFormMessage();
		seedConversation(message, ...laterProcessMessages());
		useProjectStore.setState({ activeProjectId: "project-active" });

		render(<AgentFormCard message={message} />);

		await waitFor(() => expect(screen.getByText("确认生成")).toBeDisabled());
		expect(screen.getByText("取消")).toBeEnabled();
		expect(decideAgentSelection).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("取消"));

		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		expect(vi.mocked(decideAgentSelection).mock.calls[0]?.[1]).toEqual({ cancelled: true });
		await waitFor(() => expect(screen.getByText(/已取消/)).toBeTruthy());
	});

	it("does not seed a raw composite default before the adapter emits its canonical value", async () => {
		mocks.generationSettingsRuntime = {
			...mocks.generationSettingsRuntime,
			emitValue: false,
			valid: true,
		};
		const message = generationSettingsFormMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-active" });

		render(<AgentFormCard message={message} />);

		await waitFor(() => expect(screen.getByText("确认生成")).toBeDisabled());
		expect(decideAgentSelection).not.toHaveBeenCalled();
	});

	it("tracks repeated field busy reports idempotently by field id", async () => {
		const message = generationSettingsFormMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-active" });
		render(<AgentFormCard message={message} />);

		await waitFor(() => expect(screen.getByText("确认生成")).toBeEnabled());
		fireEvent.click(screen.getByText("重复上报忙碌"));
		await waitFor(() => expect(screen.getByText("确认生成")).toBeDisabled());
		fireEvent.click(screen.getByText("上报空闲"));
		await waitFor(() => expect(screen.getByText("确认生成")).toBeEnabled());
	});

	it("freezes a form whose server record is already decided even without a local decision", async () => {
		// Covers forms decided before local persistence existed, or in another
		// window: the server's selection record is the authority.
		mocks.useSWR.mockImplementation((key: unknown) =>
			Array.isArray(key) && key[0] === "agent-selection-status"
				? {
						data: {
							record: {
								id: "selection-1",
								title: "确认生成参数",
								options: [],
								allowCustom: false,
								status: "submitted",
								decision: { values: { aspectRatio: "16:9", optimizePrompt: true, n: 2 } },
								createdAt: "2026-06-08T10:00:00.000Z",
							},
						},
					}
				: { data: undefined },
		);
		const message = formMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		expect(screen.getByText(/已提交：/)).toBeTruthy();
		expect(screen.queryByText("确认生成")).toBeNull();
		expect(screen.queryByText("取消")).toBeNull();
		// The server-derived resolution persists for later renders.
		await waitFor(() =>
			expect(useAgentPersistenceStore.getState().resolvedSelections["selection-1"]?.status).toBe(
				"submitted",
			),
		);
	});

	it("renders an already-decided form frozen and non-interactive after a hydrate", () => {
		// Simulates a transcript hydrate that re-materializes the original
		// interactive form after the user already decided it.
		useAgentPersistenceStore.setState({
			resolvedSelections: {
				"selection-1": { status: "submitted", summary: "已提交：比例 16:9 横版" },
			},
		});
		const message = formMessage();
		seedConversation(message);

		render(<AgentFormCard message={message} />);

		expect(screen.getByText("确认生成参数")).toBeTruthy();
		expect(screen.getByText("已提交：比例 16:9 横版")).toBeTruthy();
		// No interactive controls: the form cannot be confirmed a second time.
		expect(screen.queryByText("确认生成")).toBeNull();
		expect(screen.queryByText("取消")).toBeNull();
		expect(screen.queryByRole("spinbutton")).toBeNull();
		// A legacy local terminal result without intent performs one server
		// hydration so the immutable create intent can be restored. The card stays
		// frozen while that lookup runs, and terminal data does not poll.
		expect(mocks.useSWR.mock.calls[0]?.[0]).toEqual([
			"agent-selection-status",
			"project-1",
			"selection-1",
		]);
	});

	it("keeps a pending form interactive when later process messages are appended", () => {
		// ask_user_form and await_user_selection both emit process updates after the
		// card. Those transport messages do not resolve the selection and therefore
		// must not make its controls disappear.
		const message = formMessage();
		seedConversation(message, ...laterProcessMessages());
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		expect(screen.getByText("确认生成参数")).toBeTruthy();
		expect(screen.queryByText("流程已继续，无需操作。")).toBeNull();
		expect(screen.getByText("确认生成")).toBeTruthy();
		expect(screen.getByText("取消")).toBeTruthy();
		expect(screen.getByRole("spinbutton")).toBeTruthy();
	});

	it("polls a server-pending selection and stops scheduling polls for terminal data", () => {
		mocks.useSWR.mockImplementation(() => ({
			data: {
				record: {
					id: "selection-1",
					status: "pending",
				},
			},
		}));
		const message = formMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		const options = mocks.useSWR.mock.calls[0]?.[2] as {
			refreshInterval?: (data: unknown) => number;
		};
		expect(options.refreshInterval?.({ record: { status: "pending" } })).toBe(5000);
		expect(options.refreshInterval?.({ record: { status: "submitted" } })).toBe(0);
		expect(options.refreshInterval?.({ missing: true })).toBe(0);
	});

	it("renders an images field with prefilled thumbnails, removes one, and submits the id array", async () => {
		vi.mocked(decideAgentSelection).mockImplementation(
			async (_id, request) =>
				({
					id: "selection-3",
					title: "确认生成参数",
					options: [],
					allowCustom: false,
					status: "submitted",
					decision: { values: request.values },
					createdAt: "2026-06-08T10:00:00.000Z",
				}) as never,
		);
		const message = imagesFormMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		// 预填的两张定稿图渲染为缩略图，各带移除按钮。
		const removeButtons = screen.getAllByLabelText("移除参考图");
		expect(removeButtons.length).toBe(2);
		fireEvent.click(removeButtons[0]);
		await waitFor(() => expect(screen.getAllByLabelText("移除参考图").length).toBe(1));

		fireEvent.click(screen.getByText("确认生成"));
		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [, request] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect(request).toEqual({ values: { refs: ["asset-b"] } });

		// 冻结摘要按张数汇总。
		await waitFor(() => expect(screen.getByText(/已提交：/)).toBeTruthy());
		expect(screen.getByText(/参考图 1 张/)).toBeTruthy();
	});

	it("renders a prompt_optimization field with model catalog and package picker, submits the composite", async () => {
		mocks.useSWR.mockImplementation((key: unknown) => {
			if (Array.isArray(key)) return { data: undefined };
			if (key === "/prompt-presets") {
				return {
					data: [
						{
							id: "preset-2d",
							name: "2D动漫",
							category: "style",
							prompt: "纯正2D日系",
							source: "pack",
						},
					],
				};
			}
			if (key === "/prompt-categories") return { data: [] };
			return { data: promptOptimizationCatalog() };
		});
		vi.mocked(decideAgentSelection).mockImplementation(
			async (_id, request) =>
				({
					id: "selection-4",
					title: "确认生成参数",
					options: [],
					allowCustom: false,
					status: "submitted",
					decision: { values: request.values },
					createdAt: "2026-06-08T10:00:00.000Z",
				}) as never,
		);
		const message = promptOptimizationFormMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);

		// 默认开启：展示文本模型选择与提示词包列表，而不是裸开关。
		await waitFor(() => expect(screen.getByLabelText("优化模型")).toBeTruthy());
		expect(screen.getByText("2D动漫")).toBeTruthy();
		fireEvent.click(screen.getByText("2D动漫"));

		fireEvent.click(screen.getByText("确认生成"));
		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [, request] = vi.mocked(decideAgentSelection).mock.calls[0];
		const submitted = (request as { values: Record<string, unknown> }).values.optimize as Record<
			string,
			unknown
		>;
		expect(submitted.enabled).toBe(true);
		expect(submitted.routeId).toBe("official.minimax-m3");
		expect(submitted.referenceName).toBe("2D动漫");
		expect(submitted.referencePrompt).toBe("纯正2D日系");
	});

	it("normalizes a bare-boolean prompt_optimization default into the object shape on submit", async () => {
		vi.mocked(decideAgentSelection).mockImplementation(
			async (_id, request) =>
				({
					id: "selection-5",
					title: "确认生成参数",
					options: [],
					allowCustom: false,
					status: "submitted",
					decision: { values: request.values },
					createdAt: "2026-06-08T10:00:00.000Z",
				}) as never,
		);
		const message = promptOptimizationFormMessage();
		const form = message.metadata?.form;
		if (form) form.fields = [{ ...form.fields[0], default: false }];
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		render(<AgentFormCard message={message} />);
		// 用户不碰字段直接提交：boolean default 必须被归一化为对象，服务端才不会 400。
		fireEvent.click(screen.getByText("确认生成"));
		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [, request] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect((request as { values: Record<string, unknown> }).values.optimize).toEqual({
			enabled: false,
		});
	});

	it("updates the submitted prompt-optimization route when the catalog removes the current route", async () => {
		let catalog = promptOptimizationCatalog();
		mocks.useSWR.mockImplementation((key: unknown) => {
			if (Array.isArray(key) || key === "/prompt-presets" || key === "/prompt-categories") {
				return { data: undefined };
			}
			return { data: catalog };
		});
		vi.mocked(decideAgentSelection).mockImplementation(
			async (_id, request) =>
				({
					id: "selection-6",
					title: "确认生成参数",
					options: [],
					allowCustom: false,
					status: "submitted",
					decision: { values: request.values },
					createdAt: "2026-06-08T10:00:00.000Z",
				}) as never,
		);
		const message = promptOptimizationFormMessage();
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		const { rerender } = render(<AgentFormCard message={message} />);
		await waitFor(() =>
			expect(screen.getByLabelText("优化模型").textContent).toContain("MiniMax 国内"),
		);

		catalog = promptOptimizationCatalog("official.minimax-m4", "MiniMax M4 国内");
		rerender(<AgentFormCard message={message} />);
		await waitFor(() =>
			expect(screen.getByLabelText("优化模型").textContent).toContain("MiniMax M4 国内"),
		);

		fireEvent.click(screen.getByText("确认生成"));
		await waitFor(() => expect(decideAgentSelection).toHaveBeenCalledTimes(1));
		const [, request] = vi.mocked(decideAgentSelection).mock.calls[0];
		expect(
			((request as { values: Record<string, unknown> }).values.optimize as { routeId: string })
				.routeId,
		).toBe("official.minimax-m4");
	});

	it("keeps already-uploaded reference images when a later file in the batch fails", async () => {
		mocks.uploadMediaAsset
			.mockResolvedValueOnce({ id: "asset-new-1" })
			.mockRejectedValueOnce(new Error("network down"));
		const message = imagesFormMessage();
		const form = message.metadata?.form;
		if (form) form.fields = [{ ...form.fields[0], default: ["asset-a"] }];
		seedConversation(message);
		useProjectStore.setState({ activeProjectId: "project-1" });

		const { container } = render(<AgentFormCard message={message} />);
		const fileInput = container.querySelector('input[type="file"]');
		if (!fileInput) throw new Error("file input missing");
		fireEvent.change(fileInput, {
			target: {
				files: [
					new File(["a"], "a.png", { type: "image/png" }),
					new File(["b"], "b.png", { type: "image/png" }),
				],
			},
		});

		// 第 1 张成功即入列（2 张缩略图），第 2 张失败展示错误但不吞掉已成功的。
		await waitFor(() => expect(screen.getAllByLabelText("移除参考图").length).toBe(2));
		await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
	});
});

const promptOptimizationCatalog = (
	routeId = "official.minimax-m3",
	routeLabel = "MiniMax 国内",
) => ({
	families: [{ id: "minimax", label: "MiniMax", kinds: ["text"] }],
	versions: [{ id: "minimax-m3", familyId: "minimax", label: "MiniMax M3 Text", kind: "text" }],
	routes: [
		{
			id: routeId,
			familyId: "minimax",
			versionId: "minimax-m3",
			kind: "text",
			label: routeLabel,
			provider: "minimax",
			model: "m3",
			status: "available",
			configured: true,
			params: [],
		},
	],
	models: [],
	providers: [],
});

const promptOptimizationFormMessage = (): AgentMessage => ({
	id: "optimize-form-ui",
	role: "assistant",
	content: "需要你确认生成参数",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T10:00:00.000Z",
	metadata: {
		form: {
			selectionId: "selection-4",
			projectId: "project-1",
			title: "确认生成参数",
			submitLabel: "确认生成",
			fields: [
				{
					id: "optimize",
					label: "优化提示词",
					type: "prompt_optimization",
					default: { enabled: true },
				},
			],
		},
	},
});

const imagesFormMessage = (): AgentMessage => ({
	id: "images-form-ui",
	role: "assistant",
	content: "需要你确认生成参数",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T10:00:00.000Z",
	metadata: {
		form: {
			selectionId: "selection-3",
			projectId: "project-1",
			title: "确认生成参数",
			submitLabel: "确认生成",
			fields: [
				{
					id: "refs",
					label: "参考图",
					type: "images",
					max: 3,
					default: ["asset-a", "asset-b"],
				},
			],
		},
	},
});

const seedConversation = (message: AgentMessage, ...rest: AgentMessage[]) => {
	useAgentStore.setState({
		sessionId: "session-1",
		rootRunId: "run-1",
		conversations: {
			"run-1": {
				runId: "run-1",
				name: "主智能体",
				status: "running",
				messages: [message, ...rest],
				streamingMessageId: null,
				children: [],
				createdAt: "2026-06-08T10:00:00.000Z",
				updatedAt: "2026-06-08T10:00:00.000Z",
			},
		},
	});
};

const laterProcessMessages = (): AgentMessage[] => [
	{
		id: "assistant-thought",
		role: "assistant",
		content: "等待用户确认。",
		kind: "thought",
		phase: "commentary",
		status: "complete",
		createdAt: "2026-06-08T10:01:00.000Z",
	},
	{
		id: "await-tool-call",
		role: "assistant",
		content: "await_user_selection",
		kind: "tool",
		phase: "commentary",
		status: "complete",
		metadata: { toolName: "mcp.mediago_drama.await_user_selection" },
		createdAt: "2026-06-08T10:01:01.000Z",
	},
	{
		id: "await-runtime",
		role: "assistant",
		content: "等待用户选择中",
		kind: "runtime",
		phase: "commentary",
		status: "complete",
		createdAt: "2026-06-08T10:01:02.000Z",
	},
];

const generationFormMessage = (): AgentMessage => ({
	id: "generation-form-ui",
	role: "assistant",
	content: "需要你确认生成参数",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T10:00:00.000Z",
	metadata: {
		form: {
			selectionId: "selection-2",
			projectId: "project-1",
			title: "确认生成参数",
			submitLabel: "确认生成",
			fields: [
				{
					id: "generation",
					label: "模型与参数",
					type: "generation_params",
					default: {
						routeId: "mediago.gpt-image-2",
						params: { aspectRatio: "16:9", resolution: "4K", n: 2 },
					},
				},
			],
		},
	},
});

const generationSettingsFormMessage = (): AgentMessage => ({
	id: "generation-settings-form-ui",
	role: "assistant",
	content: "需要你确认图片生成设置",
	kind: "message",
	status: "complete",
	createdAt: "2026-07-15T00:00:00.000Z",
	metadata: {
		form: {
			selectionId: "selection-settings",
			title: "确认图片生成设置",
			submitLabel: "确认生成",
			fields: [
				{
					id: "settings",
					label: "不应显示旧字段标签",
					type: "generation_settings",
					kind: "image",
					default: {
						kind: "image",
						label: "Agent 原始默认值",
						params: {},
						promptOptimization: { enabled: false },
						promptSupplements: [],
						referenceAssetIds: [],
						routeId: "route-agent-raw-default",
					},
				},
			],
		},
	},
});

// Compact catalog mirroring /generation/models: one configured route per
// family plus an unconfigured DMX route that must not render.
const generationCatalog = () => ({
	families: [
		{ id: "seedream", label: "Seedream", kinds: ["image"] },
		{ id: "gpt-image", label: "GPT Image", kinds: ["image"] },
	],
	versions: [
		{ id: "seedream-5", familyId: "seedream", label: "Seedream 5.0", kind: "image" },
		{ id: "gpt-image-2", familyId: "gpt-image", label: "GPT Image 2", kind: "image" },
	],
	routes: [
		{
			id: "jimeng.seedream-5.0",
			familyId: "seedream",
			versionId: "seedream-5",
			kind: "image",
			label: "即梦",
			provider: "jimeng",
			model: "5.0",
			status: "available",
			configured: true,
			params: [
				{
					name: "aspectRatio",
					label: "比例",
					type: "select",
					default: "1:1",
					options: [
						{ value: "1:1", label: "1:1" },
						{ value: "16:9", label: "16:9" },
					],
				},
				{
					name: "resolution",
					label: "分辨率",
					type: "select",
					default: "2K",
					options: [
						{ value: "2K", label: "2K" },
						{ value: "4K", label: "4K" },
					],
				},
				{ name: "n", label: "张数", type: "number", default: 1, min: 1, max: 4 },
			],
		},
		{
			id: "mediago.gpt-image-2",
			familyId: "gpt-image",
			versionId: "gpt-image-2",
			kind: "image",
			label: "MediaGo",
			provider: "mediago",
			model: "gpt-image-2",
			status: "available",
			configured: true,
			params: [
				{
					name: "aspectRatio",
					label: "比例",
					type: "select",
					default: "1:1",
					options: [
						{ value: "1:1", label: "1:1" },
						{ value: "16:9", label: "16:9" },
					],
				},
				{
					name: "resolution",
					label: "分辨率",
					type: "select",
					default: "1K",
					options: [
						{ value: "1K", label: "1K" },
						{ value: "2K", label: "2K" },
						{ value: "4K", label: "4K" },
					],
				},
				{ name: "n", label: "张数", type: "number", default: 1, min: 1, max: 10 },
			],
			paramCombos: [
				{
					params: ["aspectRatio", "resolution"],
					allowed: [
						["1:1", "1K"],
						["1:1", "2K"],
						["16:9", "2K"],
						["16:9", "4K"],
					],
				},
			],
		},
		{
			id: "dmx.gpt-image-2",
			familyId: "gpt-image",
			versionId: "gpt-image-2",
			kind: "image",
			label: "DMX",
			provider: "dmx",
			model: "gpt-image-2-ssvip",
			status: "available",
			params: [],
		},
	],
	models: [],
	providers: [],
});

const formMessage = (): AgentMessage => ({
	id: "form-ui",
	role: "assistant",
	content: "需要你确认参数",
	kind: "message",
	status: "complete",
	createdAt: "2026-06-08T10:00:00.000Z",
	metadata: {
		form: {
			selectionId: "selection-1",
			projectId: "project-1",
			title: "确认生成参数",
			submitLabel: "确认生成",
			fields: [
				{
					id: "aspectRatio",
					label: "比例",
					type: "select",
					default: "3:4",
					options: [
						{ value: "3:4", label: "3:4 竖版" },
						{ value: "16:9", label: "16:9 横版" },
					],
				},
				{ id: "optimizePrompt", label: "优化提示词", type: "toggle", default: true },
				{ id: "n", label: "张数", type: "number", default: 4, min: 1, max: 4 },
			],
		},
	},
});
