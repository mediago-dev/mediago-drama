import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationRoute, GenerationVersion } from "@/domains/generation/api/generation";
import {
	GenerationModelRoutePicker,
	shouldKeepGenerationRoutePickerVersionActive,
} from "./GenerationModelRoutePicker";

const versions: GenerationVersion[] = [
	{
		canonicalModel: "nano-banana-2",
		capabilities: { async: false, supportsReferenceUrls: true },
		familyId: "image-family",
		id: "version-nano-2",
		kind: "image",
		label: "Nano Banana 2",
	},
	{
		canonicalModel: "nano-banana-gemini",
		capabilities: { async: false, supportsReferenceUrls: true },
		familyId: "image-family",
		id: "version-nano-gemini",
		kind: "image",
		label: "Nano Banana / Gemini",
	},
];

const routes: GenerationRoute[] = [
	{
		adapter: "test.image.mediago",
		async: false,
		docUrl: "https://example.com/mediago",
		familyId: "image-family",
		id: "route-mediago",
		kind: "image",
		label: "MediaGo image",
		model: "nano-banana-2",
		params: [],
		provider: "mediago",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "version-nano-2",
	},
	{
		adapter: "test.image.openai",
		async: false,
		docUrl: "https://example.com/openai",
		familyId: "image-family",
		id: "route-openai",
		kind: "image",
		label: "OpenAI image",
		model: "nano-banana-gemini",
		params: [],
		provider: "openai",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "version-nano-gemini",
	},
];

const disabledGeminiRoutes: GenerationRoute[] = [
	routes[1],
	{
		adapter: "test.image.mediago",
		async: false,
		configured: false,
		docUrl: "https://example.com/mediago",
		familyId: "image-family",
		id: "route-mediago-gemini",
		kind: "image",
		label: "MediaGo Gemini",
		model: "nano-banana-gemini",
		params: [],
		provider: "mediago",
		status: "gated",
		statusReason: "当前路线暂不可用",
		supportsReferenceUrls: true,
		versionId: "version-nano-gemini",
	},
	{
		adapter: "test.image.openrouter",
		async: false,
		configured: false,
		docUrl: "https://example.com/openrouter",
		familyId: "image-family",
		id: "route-openrouter-gemini",
		kind: "image",
		label: "OpenRouter Gemini",
		model: "nano-banana-gemini",
		params: [],
		provider: "openrouter",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "version-nano-gemini",
	},
];

const seedreamVersions: GenerationVersion[] = [
	{
		canonicalModel: "doubao-seedream-5.0-lite",
		capabilities: { async: false, supportsReferenceUrls: true },
		familyId: "seedream",
		id: "seedream-5-lite",
		kind: "image",
		label: "Seedream 5.0 Lite",
	},
	{
		canonicalModel: "seedream-4.7",
		capabilities: { async: false, supportsReferenceUrls: true },
		familyId: "seedream",
		id: "seedream-4.7",
		kind: "image",
		label: "Seedream 4.7",
	},
];

const seedreamRoutes: GenerationRoute[] = [
	{
		adapter: "test.image.mediago",
		async: false,
		docUrl: "https://example.com/mediago",
		familyId: "seedream",
		id: "mediago.seedream-5-lite",
		kind: "image",
		label: "MediaGo Seedream 5",
		model: "doubao-seedream-5.0-lite",
		params: [],
		provider: "mediago",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "seedream-5-lite",
	},
	{
		adapter: "test.image.dmx",
		async: false,
		docUrl: "https://example.com/dmx",
		familyId: "seedream",
		id: "dmx.seedream-5-lite",
		kind: "image",
		label: "DMX Seedream 5",
		model: "doubao-seedream-5.0-lite",
		params: [],
		provider: "dmx",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "seedream-5-lite",
	},
	{
		adapter: "test.image.jimeng",
		async: false,
		docUrl: "https://example.com/jimeng",
		familyId: "seedream",
		id: "jimeng.seedream-5.0",
		kind: "image",
		label: "即梦 Seedream 5",
		model: "seedream-5.0",
		params: [],
		provider: "jimeng",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "seedream-5-lite",
	},
	{
		adapter: "test.image.jimeng",
		async: false,
		docUrl: "https://example.com/jimeng",
		familyId: "seedream",
		id: "jimeng.seedream-4.7",
		kind: "image",
		label: "即梦 Seedream 4.7",
		model: "seedream-4.7",
		params: [],
		provider: "jimeng",
		status: "available",
		supportsReferenceUrls: true,
		versionId: "seedream-4.7",
	},
];

const openRouterSeedreamRoute: GenerationRoute = {
	adapter: "test.image.openrouter",
	async: false,
	docUrl: "https://example.com/openrouter",
	familyId: "seedream",
	id: "openrouter.seedream-5-lite",
	kind: "image",
	label: "OpenRouter Seedream 5",
	model: "doubao-seedream-5.0-lite",
	params: [],
	provider: "openrouter",
	status: "available",
	supportsReferenceUrls: true,
	versionId: "seedream-5-lite",
};

const libTVSeedreamRoute: GenerationRoute = {
	adapter: "libtv.cli.image",
	async: false,
	docUrl: "https://www.liblib.tv/cli",
	familyId: "seedream",
	id: "libtv.seedream-5-lite",
	kind: "image",
	label: "LibTV",
	model: "Seedream 5.0 Lite",
	params: [],
	provider: "libtv",
	status: "available",
	supportsReferenceUrls: true,
	versionId: "seedream-5-lite",
};

const extraSeedreamRoutes: GenerationRoute[] = ["volcengine", "dmxapi"].map((provider) => ({
	adapter: `test.image.${provider}`,
	async: false,
	docUrl: `https://example.com/${provider}`,
	familyId: "seedream",
	id: `${provider}.seedream-5-lite`,
	kind: "image",
	label: `${provider} Seedream 5`,
	model: "doubao-seedream-5.0-lite",
	params: [],
	provider,
	status: "available",
	supportsReferenceUrls: true,
	versionId: "seedream-5-lite",
}));

const longSeedanceVersions: GenerationVersion[] = [
	"Seedance 2.0 Fast",
	"Seedance 2.0 Mini",
	"Seedance 2.0",
	"Seedance 2.0 Fast VIP",
	"Seedance 2.0 VIP",
	"Seedance 1.5 Pro",
].map((label, index) => ({
	canonicalModel: `seedance-${index + 1}`,
	capabilities: { async: true, supportsReferenceUrls: true },
	familyId: "seedance",
	id: `seedance-version-${index + 1}`,
	kind: "video",
	label,
}));

const longSeedanceRoutes: GenerationRoute[] = longSeedanceVersions.map((version, index) => ({
	adapter: "test.video.jimeng",
	async: true,
	docUrl: "https://example.com/jimeng",
	familyId: "seedance",
	id: `jimeng.${version.id}`,
	kind: "video",
	label: `即梦 ${version.label}`,
	model: version.canonicalModel,
	params: [],
	provider: "jimeng",
	status: index === 2 ? "gated" : "available",
	supportsReferenceUrls: true,
	versionId: version.id,
}));

describe("GenerationModelRoutePicker", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("uses a fixed five-row menu height across provider counts", () => {
		render(
			<GenerationModelRoutePicker
				onSelect={vi.fn()}
				routes={seedreamRoutes}
				selectedRoute={seedreamRoutes[0]}
				selectedVersion={seedreamVersions[0]}
				versions={seedreamVersions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const menu = screen
			.getByText("提供方")
			.closest('[aria-label="模型版本和供应商"]') as HTMLElement;
		expect(menu).toBeTruthy();
		expect(menu).toHaveClass("h-[var(--generation-route-picker-menu-height)]");
		expect(menu.className).toContain("w-fit");
		expect(menu.className).toContain(
			"grid-cols-[fit-content(var(--generation-model-popover-version-column-max-width))_minmax(var(--generation-model-popover-provider-column-min-width),max-content)]",
		);
		expect(menu.getAttribute("style")).toContain(
			"5 * var(--generation-model-popover-option-height)",
		);
		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "DMX" })).toBeTruthy();

		fireEvent.pointerEnter(screen.getByRole("button", { name: "Seedream 4.7" }), {
			clientX: 160,
			clientY: 130,
		});

		expect(screen.getByRole("button", { name: "即梦" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "MediaGo" })).toBeNull();
		expect(menu.getAttribute("style")).toContain(
			"5 * var(--generation-model-popover-option-height)",
		);

		const routeList = document.querySelector("[data-generation-route-list]");
		expect(routeList).toBeTruthy();
		setScrollableList(routeList as HTMLElement, {
			clientHeight: 96,
			scrollHeight: 100,
			scrollTop: 0,
		});
		fireEvent.scroll(routeList as HTMLElement);

		expect(document.querySelector("[data-generation-route-scroll-hint]")).toBeNull();
	});

	it("shows a fade hint when the provider list overflows five rows", () => {
		render(
			<GenerationModelRoutePicker
				onSelect={vi.fn()}
				routes={[...seedreamRoutes, openRouterSeedreamRoute, ...extraSeedreamRoutes]}
				selectedRoute={seedreamRoutes[0]}
				selectedVersion={seedreamVersions[0]}
				versions={seedreamVersions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const routeList = document.querySelector("[data-generation-route-list]");
		expect(routeList).toBeTruthy();
		setScrollableList(routeList as HTMLElement, {
			clientHeight: 160,
			scrollHeight: 192,
			scrollTop: 0,
		});

		fireEvent.scroll(routeList as HTMLElement);

		expect(document.querySelector("[data-generation-route-scroll-hint]")).toBeTruthy();
	});

	it("caps the menu at five rows and keeps long version lists scrollable", () => {
		render(
			<GenerationModelRoutePicker
				onSelect={vi.fn()}
				routes={longSeedanceRoutes}
				selectedRoute={longSeedanceRoutes[0]}
				selectedVersion={longSeedanceVersions[0]}
				versions={longSeedanceVersions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const menu = screen
			.getByText("提供方")
			.closest('[aria-label="模型版本和供应商"]') as HTMLElement;
		expect(menu.getAttribute("style")).toContain(
			"5 * var(--generation-model-popover-option-height)",
		);

		const versionList = document.querySelector("[data-generation-version-list]");
		expect(versionList).toBeTruthy();
		expect(versionList).toHaveClass("overflow-y-auto");
		expect(versionList).toHaveClass("overscroll-contain");
		expect(versionList?.parentElement).toHaveClass("overflow-hidden");
		expect(versionList?.closest("section")).toHaveClass("h-full");
		expect(versionList?.closest("section")).toHaveClass("overflow-hidden");
		setScrollableList(versionList as HTMLElement, {
			clientHeight: 160,
			scrollHeight: 192,
			scrollTop: 0,
		});
		fireEvent.scroll(versionList as HTMLElement);

		expect(document.querySelector("[data-generation-version-scroll-hint]")).toBeTruthy();
	});

	it("scrolls the version list directly on wheel events", () => {
		render(
			<GenerationModelRoutePicker
				onSelect={vi.fn()}
				routes={longSeedanceRoutes}
				selectedRoute={longSeedanceRoutes[0]}
				selectedVersion={longSeedanceVersions[0]}
				versions={longSeedanceVersions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const versionList = document.querySelector("[data-generation-version-list]");
		expect(versionList).toBeTruthy();
		setScrollableList(versionList as HTMLElement, {
			clientHeight: 160,
			scrollHeight: 224,
			scrollTop: 0,
		});

		fireEvent.wheel(versionList as HTMLElement, { deltaY: 40 });

		expect((versionList as HTMLElement).scrollTop).toBe(40);
		expect(document.querySelector("[data-generation-version-scroll-hint]")).toBeTruthy();
	});

	it("hides the fade hint when only layout rounding remains below the version list", () => {
		render(
			<GenerationModelRoutePicker
				onSelect={vi.fn()}
				routes={longSeedanceRoutes}
				selectedRoute={longSeedanceRoutes[0]}
				selectedVersion={longSeedanceVersions[0]}
				versions={longSeedanceVersions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const versionList = document.querySelector("[data-generation-version-list]");
		expect(versionList).toBeTruthy();
		setScrollableList(versionList as HTMLElement, {
			clientHeight: 160,
			scrollHeight: 166,
			scrollTop: 0,
		});
		fireEvent.scroll(versionList as HTMLElement);

		expect(document.querySelector("[data-generation-version-scroll-hint]")).toBeNull();
	});

	it("hides the fade hint when all rendered version rows are visible", () => {
		const visibleVersions = longSeedanceVersions.slice(0, 5);
		const visibleRoutes = longSeedanceRoutes.slice(0, 5);
		render(
			<GenerationModelRoutePicker
				onSelect={vi.fn()}
				routes={visibleRoutes}
				selectedRoute={visibleRoutes[0]}
				selectedVersion={visibleVersions[0]}
				versions={visibleVersions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const versionList = document.querySelector("[data-generation-version-list]");
		expect(versionList).toBeTruthy();
		const lastVersionButton = screen.getByRole("button", { name: "Seedance 2.0 VIP" });
		setScrollableList(versionList as HTMLElement, {
			clientHeight: 160,
			scrollHeight: 192,
			scrollTop: 0,
		});
		setElementLayout(lastVersionButton, {
			offsetHeight: 32,
			offsetTop: 128,
		});
		fireEvent.scroll(versionList as HTMLElement);

		expect(document.querySelector("[data-generation-version-scroll-hint]")).toBeNull();
	});

	it("shows only the version name for slash-delimited model labels", () => {
		render(
			<GenerationModelRoutePicker
				onSelect={vi.fn()}
				routes={routes}
				selectedRoute={routes[1]}
				selectedVersion={versions[1]}
				versions={versions}
			/>,
		);

		expect(screen.getByRole("button", { name: "模型版本和供应商" })).toHaveTextContent(
			"Gemini · OpenAI",
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));

		expect(screen.getByRole("button", { name: "Gemini" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Nano Banana / Gemini" })).toBeNull();
	});

	it("hides gated and unconfigured providers in the provider menu", () => {
		const onSelect = vi.fn();
		render(
			<GenerationModelRoutePicker
				onSelect={onSelect}
				routes={disabledGeminiRoutes}
				selectedRoute={routes[1]}
				selectedVersion={versions[1]}
				versions={versions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));

		expect(screen.getByRole("button", { name: "OpenAI" })).toBeEnabled();
		expect(screen.queryByRole("button", { name: "MediaGo" })).toBeNull();
		expect(screen.queryByRole("button", { name: "OpenRouter" })).toBeNull();
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("shows and selects LibTV beside other providers for the same version", () => {
		const onSelect = vi.fn();
		render(
			<GenerationModelRoutePicker
				onSelect={onSelect}
				routes={[...seedreamRoutes, libTVSeedreamRoute]}
				selectedRoute={seedreamRoutes[0]}
				selectedVersion={seedreamVersions[0]}
				versions={seedreamVersions}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));

		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "DMX" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "即梦" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "LibTV" }));

		expect(onSelect).toHaveBeenCalledWith("seedream-5-lite", "libtv.seedream-5-lite");
	});

	it("keeps the active version while the pointer crosses the safe triangle", () => {
		renderRoutePicker();

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const activeVersionButton = screen.getByRole("button", { name: "Nano Banana 2" });
		const nextVersionButton = screen.getByRole("button", { name: "Gemini" });
		const routePanel = screen.getByText("提供方").closest("section");
		expect(routePanel).toBeTruthy();
		vi.spyOn(activeVersionButton, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(routePanel as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 240, left: 240, right: 420, top: 40 }),
		);

		fireEvent.pointerEnter(activeVersionButton, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(activeVersionButton, { clientX: 160, clientY: 112 });
		fireEvent.pointerEnter(nextVersionButton, { clientX: 172, clientY: 136 });

		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "OpenAI" })).toBeNull();
		expect(nextVersionButton).not.toHaveClass("hover:bg-muted");
	});

	it("switches version when the pointer dwells on a crossed version", () => {
		vi.useFakeTimers();
		renderRoutePicker();

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const activeVersionButton = screen.getByRole("button", { name: "Nano Banana 2" });
		const nextVersionButton = screen.getByRole("button", { name: "Gemini" });
		const routePanel = screen.getByText("提供方").closest("section");
		expect(routePanel).toBeTruthy();
		vi.spyOn(activeVersionButton, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(routePanel as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 240, left: 240, right: 420, top: 40 }),
		);

		fireEvent.pointerEnter(activeVersionButton, { clientX: 150, clientY: 96 });
		fireEvent.pointerMove(activeVersionButton, { clientX: 160, clientY: 112 });
		fireEvent.pointerEnter(nextVersionButton, { clientX: 172, clientY: 136 });

		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "OpenAI" })).toBeNull();

		act(() => {
			vi.advanceTimersByTime(200);
		});

		expect(screen.getByRole("button", { name: "OpenAI" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "MediaGo" })).toBeNull();
	});

	it("switches version immediately when the pointer is not moving toward the provider panel", () => {
		renderRoutePicker();

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const activeVersionButton = screen.getByRole("button", { name: "Nano Banana 2" });
		const nextVersionButton = screen.getByRole("button", { name: "Gemini" });
		const routePanel = screen.getByText("提供方").closest("section");
		expect(routePanel).toBeTruthy();
		vi.spyOn(activeVersionButton, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 124, left: 20, right: 220, top: 80 }),
		);
		vi.spyOn(routePanel as HTMLElement, "getBoundingClientRect").mockReturnValue(
			testRect({ bottom: 240, left: 240, right: 420, top: 40 }),
		);

		fireEvent.pointerEnter(activeVersionButton, { clientX: 188, clientY: 96 });
		fireEvent.pointerMove(activeVersionButton, { clientX: 200, clientY: 112 });
		fireEvent.pointerEnter(nextVersionButton, { clientX: 200, clientY: 136 });

		expect(screen.getByRole("button", { name: "OpenAI" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "MediaGo" })).toBeNull();
	});

	it("debounces version changes when the pointer returns from the provider panel", () => {
		vi.useFakeTimers();
		renderRoutePicker();

		fireEvent.click(screen.getByRole("button", { name: "模型版本和供应商" }));
		const routePanel = screen.getByText("提供方").closest("section");
		const crossedVersionButton = screen.getByRole("button", { name: "Gemini" });
		expect(routePanel).toBeTruthy();

		fireEvent.pointerLeave(routePanel as HTMLElement);
		fireEvent.pointerEnter(crossedVersionButton, { clientX: 180, clientY: 136 });

		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "OpenAI" })).toBeNull();
		act(() => vi.advanceTimersByTime(149));
		expect(screen.getByRole("button", { name: "MediaGo" })).toBeTruthy();
		act(() => vi.advanceTimersByTime(1));
		expect(screen.getByRole("button", { name: "OpenAI" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "MediaGo" })).toBeNull();
	});
});

describe("shouldKeepGenerationRoutePickerVersionActive", () => {
	it("keeps the version active for diagonal movement through the safe triangle", () => {
		expect(
			shouldKeepGenerationRoutePickerVersionActive({
				activeRect: { bottom: 124, left: 20, right: 220, top: 80 },
				origin: { x: 160, y: 112 },
				point: { x: 172, y: 136 },
				submenuRect: { bottom: 240, left: 240, right: 420, top: 40 },
			}),
		).toBe(true);
	});

	it("does not keep the version active for vertical movement inside the version column", () => {
		expect(
			shouldKeepGenerationRoutePickerVersionActive({
				activeRect: { bottom: 124, left: 20, right: 220, top: 80 },
				origin: { x: 188, y: 112 },
				point: { x: 188, y: 136 },
				submenuRect: { bottom: 240, left: 240, right: 420, top: 40 },
			}),
		).toBe(false);
	});
});

const renderRoutePicker = () =>
	render(
		<GenerationModelRoutePicker
			onSelect={vi.fn()}
			routes={routes}
			selectedRoute={routes[0]}
			selectedVersion={versions[0]}
			versions={versions}
		/>,
	);

const setScrollableList = (
	element: HTMLElement,
	{
		clientHeight,
		scrollHeight,
		scrollTop,
	}: {
		clientHeight: number;
		scrollHeight: number;
		scrollTop: number;
	},
) => {
	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		value: clientHeight,
	});
	Object.defineProperty(element, "scrollHeight", {
		configurable: true,
		value: scrollHeight,
	});
	Object.defineProperty(element, "scrollTop", {
		configurable: true,
		value: scrollTop,
		writable: true,
	});
};

const setElementLayout = (
	element: HTMLElement,
	{
		offsetHeight,
		offsetTop,
	}: {
		offsetHeight: number;
		offsetTop: number;
	},
) => {
	Object.defineProperty(element, "offsetHeight", {
		configurable: true,
		value: offsetHeight,
	});
	Object.defineProperty(element, "offsetTop", {
		configurable: true,
		value: offsetTop,
	});
};

const testRect = ({
	bottom,
	left,
	right,
	top,
}: {
	bottom: number;
	left: number;
	right: number;
	top: number;
}) =>
	({
		bottom,
		height: bottom - top,
		left,
		right,
		toJSON: () => ({}),
		top,
		width: right - left,
		x: left,
		y: top,
	}) as DOMRect;
