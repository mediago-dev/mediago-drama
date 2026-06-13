import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilitiesKey, type CapabilityRecord } from "@/domains/capabilities/api/capabilities";
import {
	StudioTypesScreen,
	WorkModeSwitcher,
} from "@/domains/workspace/components/ProjectNavigatorPanels";

describe("WorkModeSwitcher", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders work modes as text labels without icons", () => {
		const { container } = render(<WorkModeSwitcher activeMode="agent" onSelectMode={vi.fn()} />);
		const switcher = screen.getByLabelText("工作模式");

		expect(within(switcher).getByRole("button", { name: "智能体" }).textContent).toBe("智能体");
		expect(within(switcher).getByRole("button", { name: "工具箱" }).textContent).toBe("工具箱");
		expect(container.querySelector("svg")).toBeNull();
	});

	it("selects a work mode from the text button", () => {
		const onSelectMode = vi.fn();
		render(<WorkModeSwitcher activeMode="agent" onSelectMode={onSelectMode} />);

		fireEvent.click(screen.getByRole("button", { name: "工具箱" }));

		expect(onSelectMode).toHaveBeenCalledWith("studio");
	});

	it("does not render disabled understanding studio tools", () => {
		render(
			<SWRConfig value={{ provider: () => new Map(), revalidateOnMount: false }}>
				<StudioTypesScreen
					activeCapabilityId={null}
					activeMode="studio"
					activeTab={null}
					onOpenSettings={vi.fn()}
					onSelectMode={vi.fn()}
					onSelectTab={vi.fn()}
				/>
			</SWRConfig>,
		);

		expect(screen.queryByText("理解")).toBeNull();
		expect(screen.queryByText("小说切片")).toBeNull();
		expect(screen.queryByText("视频切片")).toBeNull();
		expect(screen.queryByText("小说理解")).toBeNull();
		expect(screen.queryByText("视频理解")).toBeNull();
		expect(screen.queryByText("音频转录")).toBeNull();
		expect(screen.queryByText("Coming soon")).toBeNull();
	});

	it("keeps generation tools clickable when routes are not configured", () => {
		const onSelectTab = vi.fn();
		render(
			<SWRConfig
				value={{
					provider: () => new Map(),
					fallback: {
						[capabilitiesKey]: {
							capabilities: [
								capability("video.generate", "视频生成", "video"),
								capability("image.generate", "图片生成", "image"),
								capability("text.generate", "文本生成", "text"),
							],
						},
					},
				}}
			>
				<StudioTypesScreen
					activeCapabilityId={null}
					activeMode="studio"
					activeTab={null}
					onOpenSettings={vi.fn()}
					onSelectMode={vi.fn()}
					onSelectTab={onSelectTab}
				/>
			</SWRConfig>,
		);

		for (const [label, tab] of [
			["视频生成", "video"],
			["图片生成", "image"],
			["文本生成", "text"],
		] as const) {
			const button = screen.getByText(label).closest("button");
			expect(button?.disabled).toBe(false);
			fireEvent.click(button as HTMLButtonElement);
			expect(onSelectTab).toHaveBeenLastCalledWith(tab);
		}
	});
});

const capability = (
	id: string,
	name: string,
	kind: "image" | "video" | "text",
): CapabilityRecord => ({
	available: false,
	category: "generation",
	description: name,
	icon: kind === "image" ? "Image" : kind === "video" ? "Film" : "FileText",
	id,
	inputs: ["text"],
	kind,
	name,
	outputs: [kind],
	relatedRoutes: [`${kind}.route`],
	status: "available",
	surface: "generation",
});
