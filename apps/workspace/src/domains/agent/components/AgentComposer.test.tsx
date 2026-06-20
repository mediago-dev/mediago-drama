import { cleanup, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentReference } from "@/domains/agent/api/agent";
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
	});

	it("limits the chat input to an automatic 2-to-9-line height", () => {
		const { container } = render(<AgentComposer />);
		const composer = container.querySelector<HTMLElement>(".agent-composer-surface");

		expect(composer?.className).toContain("resize-none");
		expect(composer?.className).toContain("overflow-y-auto");
	});
});
