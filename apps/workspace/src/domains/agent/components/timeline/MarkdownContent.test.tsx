import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders inline markdown emphasis in assistant messages", () => {
		const { container } = render(
			<MarkdownContent content={"这个项目文档显示共有 **1806 字**。"} />,
		);

		expect(screen.getByText("1806 字").tagName).toBe("STRONG");
		expect(container.textContent).toBe("这个项目文档显示共有 1806 字。");
	});

	it("renders ordered lists and inline code", () => {
		render(<MarkdownContent content={"1. 调用 `get_document_outline`\n2. 读取章节"} />);

		expect(screen.getByText("get_document_outline").tagName).toBe("CODE");
		expect(screen.getByText("读取章节").tagName).toBe("LI");
	});

	it("renders pipe markdown tables", () => {
		const { container } = render(
			<MarkdownContent
				content={
					"四个角色文档已生成完毕：\n\n|文件|角色|类型|\n|-----|-----|-----|\n|林夜.md|人类主角，28岁系统工程师|3DCG写实系青年|\n|零.md|天枢AI意识体，光效人形|3DCG半透明光效|"
				}
			/>,
		);

		expect(screen.getByRole("table")).toBeTruthy();
		expect(screen.getByRole("columnheader", { name: "文件" })).toBeTruthy();
		expect(screen.getByRole("cell", { name: "天枢AI意识体，光效人形" })).toBeTruthy();
		expect(container.textContent).not.toContain("|-----|");
	});

	it("renders local file links with angle-bracket markdown destinations", () => {
		const { container } = render(
			<MarkdownContent
				content={
					"已把第一章改成动漫剧本，并新建到：\n[第一章 示例剧本.md](</tmp/Application Support/media-cli/workspace/agent/project-example/work/第一章 示例剧本.md:1>)"
				}
			/>,
		);

		const link = screen.getByRole("link", {
			name: "第一章 示例剧本.md",
		});
		const href = link.getAttribute("href") ?? "";

		expect(container.textContent).not.toContain("](");
		expect(href).toContain("Application%20Support");
		expect(href).toContain("%E7%AC%AC%E4%B8%80%E7%AB%A0");
		expect(href).not.toContain(".md:1");
	});

	it("renders MiniMax inline think tags with the existing thought styling", () => {
		const { container } = render(
			<MarkdownContent
				content={
					"<think>\n用户只是问候，按照指示不要修改文件，简洁回复即可。\n</think>\n你好！我是 MediaGo Drama 的项目 Agent。"
				}
			/>,
		);

		expect(screen.getByRole("button", { name: /思考/ })).toBeTruthy();
		expect(screen.getByText(/用户只是问候/)).toBeTruthy();
		expect(screen.getByText("你好！我是 MediaGo Drama 的项目 Agent。")).toBeTruthy();
		expect(container.textContent).not.toContain("<think>");
		expect(container.textContent).not.toContain("</think>");
	});

	it("keeps think tags inside fenced code blocks as code", () => {
		render(<MarkdownContent content={"```txt\n<think>\nraw\n</think>\n```"} />);

		expect(screen.queryByRole("button", { name: /思考/ })).toBeNull();
		expect(screen.getByText(/<think>/)).toBeTruthy();
	});
});
