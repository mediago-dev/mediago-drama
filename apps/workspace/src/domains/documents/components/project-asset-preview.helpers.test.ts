import { afterEach, describe, expect, it, vi } from "vitest";
import {
	assetKindLabel,
	fetchTextAsset,
	projectAssetContentURL,
	splitFrontmatter,
	textPreviewMaxChars,
	truncateTextPreview,
} from "./project-asset-preview.helpers";

const truncationMarker = "\n\n...";

const clearDesktopRuntime = () => {
	delete window.mediagoDesktop;
};

const enableDesktopRuntime = () => {
	window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;
};

describe("project asset preview helpers", () => {
	afterEach(() => {
		clearDesktopRuntime();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("resolves missing project asset URLs through the packaged server origin", () => {
		vi.stubEnv("DEV", false);
		enableDesktopRuntime();

		expect(
			projectAssetContentURL({
				id: "asset-1",
				projectId: "project-1",
				url: "",
			}),
		).toBe("http://127.0.0.1:48273/api/v1/projects/project-1/assets/asset-1/content");
	});

	it("normalizes project asset API URLs before text fetches in packaged builds", () => {
		vi.stubEnv("DEV", false);
		enableDesktopRuntime();

		expect(
			projectAssetContentURL({
				id: "asset-1",
				projectId: "project-1",
				url: "/api/v1/projects/project-1/assets/asset-1/content",
			}),
		).toBe("http://127.0.0.1:48273/api/v1/projects/project-1/assets/asset-1/content");
	});

	it("keeps text previews at or below the cap untouched", () => {
		const text = "短文本";
		expect(truncateTextPreview(text)).toBe(text);
	});

	it("truncates oversized text previews with a marker", () => {
		const preview = truncateTextPreview("a".repeat(textPreviewMaxChars + 1));
		expect(preview).toHaveLength(textPreviewMaxChars + truncationMarker.length);
		expect(preview.endsWith(truncationMarker)).toBe(true);
	});

	it("requests only the preview byte range and returns truncated text", async () => {
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response("a".repeat(textPreviewMaxChars + 1), {
					headers: { "Content-Type": "text/plain" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const text = await fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Range: "bytes=0-524287" } });
		expect(text).toHaveLength(textPreviewMaxChars + truncationMarker.length);
		expect(text.endsWith(truncationMarker)).toBe(true);
	});

	it("retries without a byte range when the server rejects it", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
			init?.headers
				? new Response(null, { status: 416 })
				: new Response("", { headers: { "Content-Type": "text/plain" } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content")).resolves.toBe(
			"",
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][1]).toBeUndefined();
	});

	it("decodes GBK/GB18030-encoded Chinese text assets", async () => {
		// 「中文」 encoded as GBK — invalid as UTF-8, so it would render as mojibake
		// if decoded with the default Response.text() assumption.
		const gbkBytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(gbkBytes, { headers: { "Content-Type": "text/plain" } })),
		);

		await expect(fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content")).resolves.toBe(
			"中文",
		);
	});

	it("keeps decoding UTF-8 Chinese text assets", async () => {
		const utf8Bytes = new TextEncoder().encode("扮演神明的我成真了");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(utf8Bytes, { headers: { "Content-Type": "text/plain" } })),
		);

		await expect(fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content")).resolves.toBe(
			"扮演神明的我成真了",
		);
	});

	it("does not misdetect UTF-8 text sliced mid-character as a legacy encoding", async () => {
		// The ranged preview fetch can cut the final multibyte sequence in half;
		// the intact prefix must still decode as UTF-8, not fall back to GB18030.
		const full = new TextEncoder().encode("神明成真");
		const sliced = full.slice(0, full.length - 1);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(sliced, { headers: { "Content-Type": "text/plain" } })),
		);

		const text = await fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content");
		expect(text.startsWith("神明成")).toBe(true);
	});

	it("rejects frontend HTML fallback responses for text assets", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<!doctype html><html></html>", {
						headers: { "Content-Type": "text/html" },
					}),
			),
		);

		await expect(
			fetchTextAsset("/api/v1/projects/project-1/assets/asset-1/content"),
		).rejects.toThrow("素材接口返回了前端页面");
	});

	it("localizes asset kinds and falls back to 文件 for unknown kinds", () => {
		expect(assetKindLabel("image")).toBe("图片");
		expect(assetKindLabel("video")).toBe("视频");
		expect(assetKindLabel("audio")).toBe("音频");
		expect(assetKindLabel("text")).toBe("文本");
		expect(assetKindLabel("binary")).toBe("文件");
		expect(assetKindLabel("whatever")).toBe("文件");
	});

	it("splits a leading YAML frontmatter block from the body", () => {
		const text = "---\nid: doc-1\ntitle: 舔狗系统\nversion: 6\n---\n正文第一行\n第二行";
		const { body, frontmatter } = splitFrontmatter(text);
		expect(frontmatter).toBe("id: doc-1\ntitle: 舔狗系统\nversion: 6");
		expect(body).toBe("正文第一行\n第二行");
	});

	it("leaves text without frontmatter untouched", () => {
		const text = "没有任何 frontmatter 的普通正文\n第二行";
		const { body, frontmatter } = splitFrontmatter(text);
		expect(frontmatter).toBeNull();
		expect(body).toBe(text);
	});

	it("does not treat an unterminated fence as frontmatter", () => {
		const text = "---\nid: doc-1\n没有结束围栏";
		const { body, frontmatter } = splitFrontmatter(text);
		expect(frontmatter).toBeNull();
		expect(body).toBe(text);
	});
});
