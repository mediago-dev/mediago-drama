import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiffBlock, JsonViewBlock, TextOutputBlock } from "./CodeBlocks";

describe("CodeBlocks", () => {
	afterEach(cleanup);

	it("renders text output with line and byte metadata", () => {
		render(<TextOutputBlock label="stdout · 文本输出" text={"已写入文件\n下一步生成参考图"} />);

		expect(screen.getByText("stdout · 文本输出")).toBeTruthy();
		expect(screen.getByText(/2 lines/)).toBeTruthy();
		expect(screen.getByText(/已写入文件/)).toBeTruthy();
	});

	it("renders JSON output with a structured header", () => {
		render(
			<JsonViewBlock
				label="rawOutput · JSON"
				value={{ file: "第二章 分镜脚本.md", ok: true, shots: 18 }}
			/>,
		);

		expect(screen.getByText("rawOutput · JSON")).toBeTruthy();
		expect(screen.getByText(/B JSON/)).toBeTruthy();
		expect(
			screen.getByText(
				(_, element) =>
					String(element?.className).includes("agent-json-key") &&
					Boolean(element?.textContent?.includes("file")),
			),
		).toBeTruthy();
		expect(screen.getByText('"第二章 分镜脚本.md"')).toBeTruthy();
	});

	it("renders diff output with added and removed rows", () => {
		render(
			<DiffBlock
				block={{
					type: "diff",
					path: "docs/第二章 分镜脚本.md",
					oldText: "时长：约 3s\n运镜：固定机位",
					newText: "时长：约 4s\n运镜：手持跟随",
				}}
			/>,
		);

		expect(screen.getByText("docs/第二章 分镜脚本.md")).toBeTruthy();
		expect(screen.getByText("-时长：约 3s")).toBeTruthy();
		expect(screen.getByText("+运镜：手持跟随")).toBeTruthy();
	});
});
