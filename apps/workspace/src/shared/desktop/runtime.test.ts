import { afterEach, describe, expect, it } from "vitest";
import { desktopRuntime } from "@/shared/desktop/runtime";

afterEach(() => {
	delete window.mediagoDesktop;
});

describe("desktopRuntime", () => {
	it("detects browser", () => {
		expect(desktopRuntime()).toBe("browser");
	});

	it("detects electron", () => {
		window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;
		expect(desktopRuntime()).toBe("electron");
	});
});
