import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopActions = vi.hoisted(() => ({
	copyDesktopFileToDirectory: vi.fn(),
	pickDesktopDirectory: vi.fn(),
}));

vi.mock("@/shared/desktop/actions", () => desktopActions);

import { downloadFilename, downloadLocalFileWithDirectoryPicker } from "./downloads";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("downloadFilename", () => {
	it("uses the provided title and appends an extension from the mime type", () => {
		expect(
			downloadFilename({
				kind: "image",
				mimeType: "image/png",
				title: "第一幕：角色/林书彤",
			}),
		).toBe("第一幕：角色 林书彤.png");
	});

	it("keeps an existing file extension", () => {
		expect(downloadFilename({ kind: "video", title: "导出片段.mp4" })).toBe("导出片段.mp4");
	});

	it("adds clip export prefixes and suffixes before the extension", () => {
		expect(
			downloadFilename({
				kind: "video",
				mimeType: "video/mp4",
				prefix: "02-",
				suffix: "-video",
				title: "夜雨重逢",
			}),
		).toBe("02-夜雨重逢-video.mp4");
	});

	it("returns null without copying when the user cancels directory selection", async () => {
		desktopActions.pickDesktopDirectory.mockResolvedValue(null);

		await expect(
			downloadLocalFileWithDirectoryPicker({
				kind: "image",
				sourcePath: "/tmp/source.png",
				title: "海报",
			}),
		).resolves.toBeNull();
		expect(desktopActions.copyDesktopFileToDirectory).not.toHaveBeenCalled();
	});

	it("copies the local file to the selected directory with the generated filename", async () => {
		desktopActions.pickDesktopDirectory.mockResolvedValue("/Users/me/Exports");
		desktopActions.copyDesktopFileToDirectory.mockResolvedValue({
			filename: "海报.png",
			path: "/Users/me/Exports/海报.png",
		});

		await expect(
			downloadLocalFileWithDirectoryPicker({
				kind: "image",
				mimeType: "image/png",
				sourcePath: "/tmp/source.png",
				title: "海报",
			}),
		).resolves.toEqual({
			filename: "海报.png",
			path: "/Users/me/Exports/海报.png",
		});
		expect(desktopActions.copyDesktopFileToDirectory).toHaveBeenCalledWith({
			directory: "/Users/me/Exports",
			filename: "海报.png",
			sourcePath: "/tmp/source.png",
		});
	});
});
