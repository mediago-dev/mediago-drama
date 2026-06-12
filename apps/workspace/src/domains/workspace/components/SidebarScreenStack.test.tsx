import { render } from "@testing-library/react";
import type React from "react";
import { describe, expect, it } from "vitest";
import {
	screenTransformClass,
	SidebarScreenStack,
} from "@/domains/workspace/components/SidebarScreenStack";
import type { SidebarScreenId } from "@/domains/workspace/components/ProjectNavigatorTypes";

const levels: Record<SidebarScreenId, number> = {
	projects: 1,
	"studio-types": 1,
	project: 2,
	"studio-conversations": 2,
	settings: 3,
};

const screens = Object.keys(levels).map((id) => ({
	id,
	level: levels[id as SidebarScreenId],
	node: <div>{id}</div>,
})) as Array<{ id: SidebarScreenId; level: number; node: React.ReactNode }>;

const activeSection = (container: HTMLElement, label: string) => {
	const screen = container.querySelector(`section:not([aria-hidden="true"])`);
	expect(screen?.textContent).toBe(label);
	return screen as HTMLElement;
};

describe("SidebarScreenStack", () => {
	it("switches root work modes without slide transitions", () => {
		const { container, rerender } = render(
			<SidebarScreenStack activeId="projects" screens={screens} />,
		);

		rerender(<SidebarScreenStack activeId="studio-types" screens={screens} />);

		expect(activeSection(container, "studio-types").className).toContain("transition-none");
	});

	it("slides left when entering a deeper sidebar level", () => {
		const { container, rerender } = render(
			<SidebarScreenStack activeId="projects" screens={screens} />,
		);

		rerender(<SidebarScreenStack activeId="project" screens={screens} />);

		expect(activeSection(container, "project").className).toContain("transition-transform");
		expect(container.querySelector("section")?.className).toContain("translate-x-0");
		expect(container.querySelector("section")?.className).not.toContain("-translate-x-full");
	});

	it("keeps the slide transition during immediate rerenders after a depth change", () => {
		const { container, rerender } = render(
			<SidebarScreenStack activeId="projects" screens={screens} />,
		);

		rerender(<SidebarScreenStack activeId="project" screens={screens} />);
		rerender(<SidebarScreenStack activeId="project" screens={screens} />);

		expect(activeSection(container, "project").className).toContain("transition-transform");
	});

	it("keeps lower-level screens in place behind the active screen", () => {
		const className = screenTransformClass({ id: "projects", level: 1 }, "project", 2, null);

		expect(className).toContain("translate-x-0");
		expect(className).not.toContain("-translate-x-full");
	});

	it("slides right when returning to a shallower sidebar level", () => {
		const { container, rerender } = render(
			<SidebarScreenStack activeId="settings" screens={screens} />,
		);

		rerender(<SidebarScreenStack activeId="project" screens={screens} />);

		expect(activeSection(container, "project").className).toContain("transition-transform");
		const settingsSection = Array.from(container.querySelectorAll("section")).find(
			(section) => section.textContent === "settings",
		);
		expect(settingsSection?.className).toContain("translate-x-full");
		expect(settingsSection?.className).toContain("z-20");
	});

	it("switches same-level detail screens without slide transitions", () => {
		const { container, rerender } = render(
			<SidebarScreenStack activeId="project" screens={screens} />,
		);

		rerender(<SidebarScreenStack activeId="studio-conversations" screens={screens} />);

		expect(activeSection(container, "studio-conversations").className).toContain("transition-none");
	});
});
