import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentReference } from "@/domains/agent/api/agent";
import type { AgentSkillSlashItem } from "@/domains/agent/components/AgentSkillSlashMenu";
import { AgentComposer, type AgentComposerHandle } from "./AgentComposer";

const assetReference: AgentReference = {
	kind: "asset",
	documentId: "asset-1",
	assetId: "asset-1",
	assetKind: "text",
	mimeType: "text/plain",
	title: "完美世界.txt",
	category: "reference",
	url: "/api/v1/projects/project-1/assets/asset-1/content",
};

const skillItems: AgentSkillSlashItem[] = [
	{
		name: "screenplay-writer",
		title: "剧本写作",
		description: "生成剧本正文与场景调度。",
		source: "pack",
	},
	{
		name: "character-writer",
		title: "角色小传",
		description: "整理角色动机与人物关系。",
		source: "user",
	},
];

describe("AgentComposer", () => {
	afterEach(() => cleanup());

	it("keeps inline mention text for chat bubble display", async () => {
		const ref = createRef<AgentComposerHandle>();
		render(<AgentComposer ref={ref} />);

		await waitFor(() => {
			if (!ref.current?.seed({ reference: assetReference, text: "这个文档转换成 utf8 编码吗？" })) {
				throw new Error("editor is not ready");
			}
		});

		const value = ref.current?.getValue();
		expect(value?.text.trim()).toBe("这个文档转换成 utf8 编码吗？");
		expect(value?.displayText.trim()).toBe("@完美世界.txt 这个文档转换成 utf8 编码吗？");
		expect(value?.references).toEqual([assetReference]);
		expect(value?.displaySegments).toEqual([
			{ type: "mention", title: "完美世界.txt", category: "reference", kind: "asset" },
			{ type: "text", text: " 这个文档转换成 utf8 编码吗？" },
		]);
	});

	it("limits the chat input to an automatic 2-to-9-line height", () => {
		const { container } = render(<AgentComposer />);
		const composer = container.querySelector<HTMLElement>(".agent-composer-surface");

		expect(composer?.className).toContain("resize-none");
		expect(composer?.className).toContain("overflow-y-auto");
	});

	it("shows skill suggestions after slash input and inserts a load_skill instruction", async () => {
		const ref = createRef<AgentComposerHandle>();
		render(<AgentComposer ref={ref} skillItems={skillItems} />);

		await waitFor(() => {
			if (!ref.current?.seed({ text: "/" })) {
				throw new Error("editor is not ready");
			}
		});

		expect(await screen.findByRole("listbox", { name: "Skill 列表" })).toBeTruthy();
		expect(screen.getByRole("option", { name: /剧本写作/ })).toBeTruthy();
		expect(screen.getByRole("option", { name: /角色小传/ })).toBeTruthy();

		fireEvent.mouseDown(screen.getByRole("option", { name: /角色小传/ }));

		await waitFor(() => {
			expect(ref.current?.getValue().text.trim()).toBe(
				"请先调用 MCP `load_skill` 装载 `character-writer`（角色小传），并使用该 Skill 完成以下需求：",
			);
		});
		expect(ref.current?.getValue().displayText.trim()).toBe("角色小传");
		expect(ref.current?.getValue().displaySegments).toEqual([
			{ type: "skill", name: "character-writer", title: "角色小传" },
		]);
		expect(screen.getByText("角色小传")).toBeTruthy();
		expect(screen.queryByText(/请先调用 MCP/)).toBeNull();
		expect(screen.queryByRole("listbox", { name: "Skill 列表" })).toBeNull();
	});

	it("keeps the keyboard selection stable when hovering skill suggestions", async () => {
		const ref = createRef<AgentComposerHandle>();
		render(<AgentComposer ref={ref} skillItems={skillItems} />);

		await waitFor(() => {
			if (!ref.current?.seed({ text: "/" })) {
				throw new Error("editor is not ready");
			}
		});

		const firstOption = await screen.findByRole("option", { name: /剧本写作/ });
		const secondOption = screen.getByRole("option", { name: /角色小传/ });
		expect(firstOption.getAttribute("aria-selected")).toBe("true");
		expect(secondOption.getAttribute("aria-selected")).toBe("false");

		const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
		const scrollIntoView = vi.fn();
		HTMLElement.prototype.scrollIntoView = scrollIntoView;
		try {
			fireEvent.mouseEnter(secondOption);

			expect(firstOption.getAttribute("aria-selected")).toBe("true");
			expect(secondOption.getAttribute("aria-selected")).toBe("false");
			expect(scrollIntoView).not.toHaveBeenCalled();
		} finally {
			if (originalScrollIntoView) {
				HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
			} else {
				delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
			}
		}
	});
});
