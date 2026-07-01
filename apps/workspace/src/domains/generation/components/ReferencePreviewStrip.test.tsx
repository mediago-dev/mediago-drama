import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReferencePreviewStrip } from "@/domains/generation/components/ReferencePreviewStrip";
import type { MediaAsset } from "@/domains/workspace/api/media";

describe("ReferencePreviewStrip", () => {
	afterEach(() => {
		cleanup();
	});

	it("renders selected audio references as audio tiles", () => {
		render(
			<ReferencePreviewStrip
				references={[
					mediaAsset({
						filename: "陈远音色",
						id: "voice-chenyuan",
						kind: "audio",
						mimeType: "audio/mpeg",
						url: "/api/v1/media-assets/voice-chenyuan/content",
					}),
				]}
				simple
			/>,
		);

		expect(screen.getByText("音频")).toBeTruthy();
		expect(document.querySelector("img")).toBeNull();
	});
});

const mediaAsset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
	createdAt: "2026-07-02T00:00:00.000Z",
	filename: "素材",
	id: "asset-a",
	kind: "image",
	mimeType: "image/png",
	sizeBytes: 0,
	updatedAt: "2026-07-02T00:00:00.000Z",
	url: "/api/v1/media-assets/asset-a/content",
	...overrides,
});
