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

	it("renders local file links as non-clickable text", () => {
		const { container } = render(
			<MarkdownContent
				content={
					"已把第一章改成动漫剧本，并新建到：\n[第一章 示例剧本.md](</tmp/Application Support/media-cli/workspace/agent/project-example/work/第一章 示例剧本.md:1>)"
				}
			/>,
		);

		expect(
			screen.queryByRole("link", {
				name: "第一章 示例剧本.md",
			}),
		).toBeNull();
		const fileLabel = screen.getByText("第一章 示例剧本.md");
		const fileTag = fileLabel.parentElement;
		expect(fileTag?.className).toContain("text-primary");
		expect(fileTag?.querySelector("svg")).toBeTruthy();
		expect(container.textContent).not.toContain("](");
	});

	it("renders relative markdown document links as non-clickable text", () => {
		const { container } = render(
			<MarkdownContent content={"已生成：[第一章 示例剧本.md](<第一章 示例剧本.md>)"} />,
		);

		expect(
			screen.queryByRole("link", {
				name: "第一章 示例剧本.md",
			}),
		).toBeNull();
		const fileLabel = screen.getByText("第一章 示例剧本.md");
		const fileTag = fileLabel.parentElement;
		expect(fileTag?.className).toContain("text-primary");
		expect(fileTag?.querySelector("svg")).toBeTruthy();
		expect(container.textContent).not.toContain("](");
	});

	it("keeps remote links clickable", () => {
		render(<MarkdownContent content={"查看 [官网](https://example.com/docs)。"} />);

		const link = screen.getByRole("link", {
			name: "官网",
		});

		expect(link.getAttribute("href")).toBe("https://example.com/docs");
		expect(link.getAttribute("target")).toBe("_blank");
	});

	it("keeps mailto links clickable", () => {
		render(<MarkdownContent content={"联系 [支持](mailto:support@example.com)。"} />);

		const link = screen.getByRole("link", {
			name: "支持",
		});

		expect(link.getAttribute("href")).toBe("mailto:support@example.com");
		expect(link.getAttribute("target")).toBe("_blank");
	});

	it("keeps non-local unsupported markdown links unchanged", () => {
		const { container } = render(
			<MarkdownContent content={"查看 [内部引用](mention://doc-1)。"} />,
		);

		expect(
			screen.queryByRole("link", {
				name: "内部引用",
			}),
		).toBeNull();
		expect(container.textContent).toContain("[内部引用](mention://doc-1)");
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
