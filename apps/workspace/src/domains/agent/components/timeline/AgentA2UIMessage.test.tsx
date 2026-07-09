import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/domains/agent/stores";
import { useAgentPersistenceStore } from "@/domains/agent/stores/persistence";
import { AgentA2UIMessage } from "./AgentA2UIMessage";

const mocks = vi.hoisted(() => ({ useSWR: vi.fn() }));

vi.mock("swr", () => ({ default: mocks.useSWR }));

describe("AgentA2UIMessage", () => {
	beforeEach(() => {
		// Default: the selection-status probe has no data (record still pending
		// or unreachable) so cards stay interactive unless a test overrides it.
		mocks.useSWR.mockImplementation(() => ({ data: undefined }));
	});
	afterEach(() => {
		cleanup();
		mocks.useSWR.mockReset();
		useAgentPersistenceStore.setState({ resolvedSelections: {} });
	});

	it("renders a model-returned A2UI surface", () => {
		render(<AgentA2UIMessage message={a2uiMessage("测试界面")} />);

		expect(screen.getByText("测试界面")).toBeTruthy();
	});

	it("renders a selection card with option image and posts the click action", () => {
		const onAction = vi.fn();
		render(<AgentA2UIMessage message={selectionCardMessage()} onAction={onAction} />);

		expect(screen.getByText(/选择一种插画风格/)).toBeTruthy();
		const image = document.querySelector("img");
		expect(image?.getAttribute("src")).toBe("https://x/sweet.png");

		fireEvent.click(screen.getByText(/甜美粉彩/));
		expect(onAction).toHaveBeenCalledTimes(1);
		const [, action] = onAction.mock.calls[0] ?? [];
		expect(action).toMatchObject({
			name: "agent_selection.decide",
			context: {
				kind: "agent_selection",
				optionId: "sweet",
				projectId: "project-1",
				selectionId: "selection-1",
			},
		});
	});

	it("renders a decided selection card frozen after a hydrate", () => {
		// Simulates a transcript hydrate that re-materializes the original
		// interactive selection card after the user already decided it.
		useAgentPersistenceStore.setState({
			resolvedSelections: {
				"selection-1": {
					status: "selected",
					summary: "已选择：甜美粉彩",
					title: "选择插画风格",
					imageUrl: "https://x/sweet.png",
				},
			},
		});
		const onAction = vi.fn();
		render(<AgentA2UIMessage message={selectionCardMessage()} onAction={onAction} />);

		expect(screen.getByText("选择插画风格")).toBeTruthy();
		expect(screen.getByText("已选择：甜美粉彩")).toBeTruthy();
		// The picked option's preview stays visible, and clicking it opens the
		// zoom lightbox rather than re-submitting a decision.
		expect(document.querySelector("img")?.getAttribute("src")).toBe("https://x/sweet.png");
		expect(screen.getByRole("button", { name: /查看大图/ })).toBeTruthy();
		// The interactive A2UI surface (its option buttons) is gone.
		expect(screen.queryByText(/选择一种插画风格/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /查看大图/ }));
		expect(onAction).not.toHaveBeenCalled();
	});

	it("freezes a card whose server record is already decided even without a local decision", async () => {
		// Covers cards decided before local persistence existed or in another
		// window: the server's selection record is the authority.
		mocks.useSWR.mockImplementation((key: unknown) =>
			Array.isArray(key) && key[0] === "agent-selection-status"
				? {
						data: {
							record: {
								id: "selection-1",
								title: "选择一种插画风格",
								options: [{ id: "sweet", label: "甜美粉彩", imageUrl: "https://x/sweet.png" }],
								allowCustom: false,
								status: "selected",
								decision: { optionId: "sweet" },
								createdAt: "2026-06-08T10:00:00.000Z",
							},
						},
					}
				: { data: undefined },
		);
		const onAction = vi.fn();
		render(<AgentA2UIMessage message={selectionCardMessage()} onAction={onAction} />);

		expect(screen.getByText("已选择：甜美粉彩")).toBeTruthy();
		expect(document.querySelector("img")?.getAttribute("src")).toBe("https://x/sweet.png");
		// The only button is the zoom trigger; no decision buttons remain.
		expect(screen.getByRole("button", { name: /查看大图/ })).toBeTruthy();
		expect(document.querySelectorAll("button")).toHaveLength(1);
		// The server-derived resolution persists for later renders.
		await waitFor(() =>
			expect(useAgentPersistenceStore.getState().resolvedSelections["selection-1"]?.status).toBe(
				"selected",
			),
		);
	});

	it("freezes a card whose server record no longer exists", () => {
		mocks.useSWR.mockImplementation((key: unknown) =>
			Array.isArray(key) && key[0] === "agent-selection-status"
				? { data: { missing: true } }
				: { data: undefined },
		);
		render(<AgentA2UIMessage message={selectionCardMessage()} />);

		expect(screen.getByText(/该卡片已失效/)).toBeTruthy();
		expect(document.querySelector("button")).toBeNull();
	});
});

// Mirrors the server-side BuildSelectionA2UI output shape.
const selectionCardMessage = (): AgentMessage => ({
	id: "selection-ui",
	role: "assistant",
	content: "需要你选择",
	kind: "message",
	status: "complete",
	metadata: {
		a2ui: {
			version: "v0.9",
			surfaceId: "agent-selection-selection-1",
			messages: [
				{
					version: "v0.9",
					createSurface: {
						surfaceId: "agent-selection-selection-1",
						catalogId: basicCatalog.id,
					},
				},
				{
					version: "v0.9",
					updateComponents: {
						surfaceId: "agent-selection-selection-1",
						components: [
							{
								id: "root",
								component: "Column",
								children: ["title", "opts-row-0"],
								align: "stretch",
							},
							{ id: "title", component: "Text", text: "选择一种插画风格", variant: "h5" },
							{
								id: "opts-row-0",
								component: "Row",
								children: ["opt-0"],
								justify: "start",
								align: "start",
							},
							{ id: "opt-0", component: "Column", children: ["opt-img-0", "opt-btn-0"] },
							{
								id: "opt-img-0",
								component: "Image",
								url: "https://x/sweet.png",
								description: "甜美粉彩",
								variant: "smallFeature",
							},
							{ id: "opt-label-0", component: "Text", text: "甜美粉彩" },
							{
								id: "opt-btn-0",
								component: "Button",
								child: "opt-label-0",
								variant: "primary",
								action: {
									event: {
										name: "agent_selection.decide",
										context: {
											kind: "agent_selection",
											projectId: "project-1",
											selectionId: "selection-1",
											optionId: "sweet",
										},
									},
								},
							},
						],
					},
				},
			],
		},
	},
});

const a2uiMessage = (text: string): AgentMessage => ({
	id: "message-ui",
	role: "assistant",
	content: "Agent 已生成交互界面。",
	kind: "message",
	status: "complete",
	metadata: {
		a2ui: {
			version: "v0.9",
			surfaceId: "attachment",
			messages: [
				{
					version: "v0.9",
					createSurface: {
						surfaceId: "attachment",
						catalogId: basicCatalog.id,
					},
				},
				{
					version: "v0.9",
					updateComponents: {
						surfaceId: "attachment",
						components: [
							{
								id: "root",
								component: "Column",
								children: ["title"],
							},
							{
								id: "title",
								component: "Text",
								text,
							},
						],
					},
				},
			],
		},
	},
});
