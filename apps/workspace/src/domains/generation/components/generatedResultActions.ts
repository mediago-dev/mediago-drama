import { useCallback, useMemo, useState } from "react";
import { mutate as mutateSWR } from "swr";
import type { KeyedMutator } from "swr";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import {
	entryPromptText,
	mediaAssetIdFromGeneratedSource,
} from "@/domains/generation/components/mediaGenerationHelpers";
import {
	generationAssetSelectionKey,
	generationAssetSource,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { saveGeneratedMediaFile, type MediaAssetsResponse } from "@/domains/workspace/api/media";
import { uploadProjectAsset } from "@/domains/workspace/api/project-assets";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import { useDocumentsStore } from "@/domains/documents/stores";
import { useToast } from "@/hooks/useToast";

interface UseGeneratedResultActionsOptions {
	mediaAssetProjectId?: string | null;
	mutateMediaAssets?: KeyedMutator<MediaAssetsResponse>;
	projectId?: string | null;
}

export const generatedAssetSaveKey = (entry: GenerationEntry, asset: GenerationAsset) =>
	`asset:${entry.id}:${generationAssetSelectionKey(asset) ?? generationAssetSource(asset)}`;

export const generatedTextSaveKey = (entry: GenerationEntry) => `text:${entry.id}`;

export const useGeneratedResultActions = ({ projectId }: UseGeneratedResultActionsOptions = {}) => {
	const toast = useToast();
	const normalizedProjectId = projectId?.trim() ?? "";
	const [savingKeys, setSavingKeys] = useState<string[]>([]);
	const [savedKeys, setSavedKeys] = useState<string[]>([]);
	const savingKeySet = useMemo(() => new Set(savingKeys), [savingKeys]);
	const savedKeySet = useMemo(() => new Set(savedKeys), [savedKeys]);

	const markSaving = useCallback((key: string, saving: boolean) => {
		setSavingKeys((current) => {
			if (saving) return current.includes(key) ? current : [...current, key];
			return current.filter((item) => item !== key);
		});
	}, []);

	const markSaved = useCallback((key: string) => {
		setSavedKeys((current) => (current.includes(key) ? current : [...current, key]));
	}, []);

	const copyText = useCallback(
		async (text: string, emptyMessage = "没有可复制的内容") => {
			const value = text.trim();
			if (!value) {
				toast.warning(emptyMessage);
				return;
			}

			try {
				await writeClipboardText(value);
				toast.copySuccess();
			} catch (error) {
				toast.error("复制失败", { description: toErrorMessage(error) });
			}
		},
		[toast],
	);

	const copyPrompt = useCallback(
		async (entry: GenerationEntry) => {
			const prompt = entryPromptText(entry).trim();
			await copyText(prompt, "没有可复制的提示词");
		},
		[copyText],
	);

	const saveAsset = useCallback(
		async (entry: GenerationEntry, asset: GenerationAsset) => {
			const key = generatedAssetSaveKey(entry, asset);
			if (savingKeySet.has(key) || savedKeySet.has(key)) return;

			const source = generationAssetSource(asset);
			if (!source) {
				toast.error("保存失败", { description: "生成结果没有可保存的文件地址。" });
				return;
			}

			markSaving(key, true);
			try {
				const savedPath = await saveGeneratedAssetToUserDirectory(
					asset,
					source,
					fallbackAssetFilename(entry, asset),
				);
				if (!savedPath) {
					return;
				}

				markSaved(key);
				toast.success("文件已保存", { description: savedPath });
			} catch (error) {
				toast.error("保存失败", { description: toErrorMessage(error) });
			} finally {
				markSaving(key, false);
			}
		},
		[markSaved, markSaving, savedKeySet, savingKeySet, toast],
	);

	const saveText = useCallback(
		async (entry: GenerationEntry) => {
			if (!normalizedProjectId) return;
			const key = generatedTextSaveKey(entry);
			if (savingKeySet.has(key) || savedKeySet.has(key)) return;

			const content = entry.content.trim();
			if (!content) {
				toast.error("保存失败", { description: "文本生成结果为空。" });
				return;
			}

			markSaving(key, true);
			try {
				const filename = `${sanitizeFilename(entryPromptText(entry) || "文本生成结果")}.txt`;
				const file = new File([content], filename, { type: "text/plain;charset=utf-8" });
				const projectAsset = await uploadProjectAsset(normalizedProjectId, file);
				const state = await getWorkspaceDocuments(normalizedProjectId);
				useDocumentsStore.getState().hydrateWorkspaceDocuments(state);
				await mutateSWR(workspaceDocumentsKey(normalizedProjectId));
				markSaved(key);
				toast.success("文本素材已保存", {
					description: projectAsset.filename || filename,
				});
			} catch (error) {
				toast.error("保存失败", { description: toErrorMessage(error) });
			} finally {
				markSaving(key, false);
			}
		},
		[markSaved, markSaving, normalizedProjectId, savedKeySet, savingKeySet, toast],
	);

	return {
		canSaveText: Boolean(normalizedProjectId),
		copyPrompt,
		copyText,
		saveAsset,
		saveText,
		savedKeys,
		savingKeys,
	};
};

const writeClipboardText = async (text: string) => {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "true");
	textarea.style.position = "fixed";
	textarea.style.left = "-9999px";
	document.body.appendChild(textarea);
	textarea.select();
	const copied = document.execCommand("copy");
	document.body.removeChild(textarea);
	if (!copied) throw new Error("当前浏览器不支持剪贴板写入。");
};

export const generationAssetFile = async (
	asset: GenerationAsset,
	source: string,
	fallbackFilename: string,
) => {
	const blob = await generationAssetBlob(asset, source);
	const type = asset.mimeType || blob.type || defaultMimeType(asset.kind);
	const filename = ensureFilenameExtension(fallbackFilename, type, asset.kind);
	return new File([blob], filename, { type });
};

export const saveGeneratedAssetToUserDirectory = async (
	asset: GenerationAsset,
	source: string,
	fallbackFilename: string,
) => {
	const target = await pickGeneratedAssetSaveTarget();
	if (!target) return null;
	return saveGeneratedAssetToTarget(asset, source, fallbackFilename, target);
};

export type GeneratedAssetSaveTarget =
	| { kind: "tauri"; directory: string }
	| { kind: "browser"; directory: BrowserDirectoryHandle };

export const pickGeneratedAssetSaveTarget = async (): Promise<GeneratedAssetSaveTarget | null> => {
	if (isTauriRuntime()) {
		const directory = await pickSaveDirectory();
		return directory ? { kind: "tauri", directory } : null;
	}

	const directory = await pickBrowserSaveDirectory();
	return directory ? { kind: "browser", directory } : null;
};

export const saveGeneratedAssetToTarget = async (
	asset: GenerationAsset,
	source: string,
	fallbackFilename: string,
	target: GeneratedAssetSaveTarget,
) => {
	if (target.kind === "tauri") {
		return saveGeneratedAssetWithTauriDirectory(asset, source, fallbackFilename, target.directory);
	}

	const file = await generationAssetFile(asset, source, fallbackFilename);
	return saveGeneratedFileToBrowserDirectory(file, target.directory);
};

const saveGeneratedAssetWithTauriDirectory = async (
	asset: GenerationAsset,
	source: string,
	fallbackFilename: string,
	directory: string,
) => {
	if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") {
		throw new Error("只支持保存图片、视频和音频生成结果。");
	}

	const assetId = mediaAssetIdFromGeneratedSource(source) ?? undefined;
	const sourceUrl = assetId ? undefined : absoluteHttpSourceUrl(source);
	if (!assetId && !sourceUrl) {
		throw new Error("生成结果尚未缓存为本地素材，无法直接保存。");
	}

	const saved = await saveGeneratedMediaFile({
		assetId,
		directory,
		filename: ensureFilenameExtension(
			fallbackFilename,
			asset.mimeType || defaultMimeType(asset.kind),
			asset.kind,
		),
		kind: asset.kind,
		mimeType: asset.mimeType,
		sourceUrl,
	});
	return saved.path;
};

const pickSaveDirectory = async () => {
	const { open } = await import("@tauri-apps/plugin-dialog");
	const selected = await open({
		directory: true,
		multiple: false,
		title: "选择保存文件夹",
	});
	const directory = Array.isArray(selected) ? (selected[0] ?? null) : selected;
	return typeof directory === "string" && directory.trim() ? directory : null;
};

const pickBrowserSaveDirectory = async () => {
	const picker = (window as BrowserDirectoryPickerWindow).showDirectoryPicker;
	if (!picker) {
		throw new Error("当前运行环境不支持原生文件夹选择。请在桌面端使用保存功能。");
	}

	try {
		return await picker.call(window);
	} catch (error) {
		if (isAbortError(error)) return null;
		throw error;
	}
};

const saveGeneratedFileToBrowserDirectory = async (
	file: File,
	directory: BrowserDirectoryHandle,
) => {
	const filename = await availableBrowserFilename(directory, file.name);
	const fileHandle = await directory.getFileHandle(filename, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(file);
	await writable.close();
	return filename;
};

const availableBrowserFilename = async (directory: BrowserDirectoryHandle, filename: string) => {
	const sanitized = browserSafeFilename(filename);
	const dotIndex = sanitized.lastIndexOf(".");
	const stem = dotIndex > 0 ? sanitized.slice(0, dotIndex) : sanitized;
	const extension = dotIndex > 0 ? sanitized.slice(dotIndex) : "";

	for (let index = 1; index < 10_000; index += 1) {
		const candidate = index === 1 ? sanitized : `${stem}-${index}${extension}`;
		try {
			await directory.getFileHandle(candidate);
		} catch (error) {
			if (isNotFoundError(error)) return candidate;
			throw error;
		}
	}

	return `${stem}-${Date.now()}${extension}`;
};

const browserSafeFilename = (filename: string) => {
	const name = filename
		.replace(/[\\/:*?"<>|]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return name || "generated-file";
};

const isTauriRuntime = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const isAbortError = (error: unknown) =>
	error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";

const isNotFoundError = (error: unknown) =>
	error instanceof DOMException
		? error.name === "NotFoundError"
		: error instanceof Error && error.name === "NotFoundError";

const absoluteSourceUrl = (source: string) => {
	const trimmed = source.trim();
	if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) return trimmed;
	if (trimmed.startsWith("//")) return `${window.location.protocol}${trimmed}`;
	return new URL(trimmed, window.location.href).toString();
};

const absoluteHttpSourceUrl = (source: string) => {
	const url = absoluteSourceUrl(source);
	return /^https?:\/\//iu.test(url) ? url : undefined;
};

interface BrowserDirectoryPickerWindow extends Window {
	showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>;
}

interface BrowserDirectoryHandle {
	getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
}

interface BrowserFileHandle {
	createWritable: () => Promise<BrowserWritableFileStream>;
}

interface BrowserWritableFileStream {
	close: () => Promise<void>;
	write: (data: Blob) => Promise<void>;
}

const generationAssetBlob = async (asset: GenerationAsset, source: string) => {
	if (asset.base64) return base64Blob(asset.base64, asset.mimeType || defaultMimeType(asset.kind));
	if (source.startsWith("data:")) return dataUrlBlob(source);

	const response = await fetch(source);
	if (!response.ok) {
		throw new Error(`文件下载失败：${response.status}`);
	}
	return response.blob();
};

const dataUrlBlob = (source: string) => {
	const [header = "", payload = ""] = source.split(",", 2);
	const mimeType = header.match(/^data:([^;]+)/iu)?.[1] || "application/octet-stream";
	const isBase64 = /;base64/iu.test(header);
	const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
	return bytesBlob(binary, mimeType);
};

const base64Blob = (value: string, mimeType: string) => bytesBlob(atob(value), mimeType);

const bytesBlob = (binary: string, mimeType: string) => {
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new Blob([bytes], { type: mimeType });
};

const fallbackAssetFilename = (entry: GenerationEntry, asset: GenerationAsset) => {
	const prompt = sanitizeFilename(entryPromptText(entry) || "生成结果");
	return `${prompt}-${asset.kind}`;
};

const sanitizeFilename = (value: string) => {
	const normalized = value
		.replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return (normalized || "生成结果").slice(0, 40);
};

const ensureFilenameExtension = (
	filename: string,
	mimeType: string,
	kind: GenerationAsset["kind"],
) => {
	const extension = extensionForMimeType(mimeType, kind);
	return /\.[a-z0-9]{2,5}$/iu.test(filename) ? filename : `${filename}${extension}`;
};

const extensionForMimeType = (mimeType: string, kind: GenerationAsset["kind"]) => {
	const normalized = mimeType.toLowerCase();
	if (normalized.includes("png")) return ".png";
	if (normalized.includes("webp")) return ".webp";
	if (normalized.includes("gif")) return ".gif";
	if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
	if (normalized.includes("quicktime")) return ".mov";
	if (normalized.includes("webm")) return ".webm";
	if (normalized.includes("mp4")) return ".mp4";
	if (normalized.includes("mpeg") || normalized.includes("mp3")) return ".mp3";
	if (normalized.includes("wav")) return ".wav";
	if (normalized.includes("flac")) return ".flac";
	if (normalized.includes("plain")) return ".txt";
	return kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : kind === "text" ? ".txt" : ".png";
};

const defaultMimeType = (kind: GenerationAsset["kind"]) => {
	if (kind === "video") return "video/mp4";
	if (kind === "audio") return "audio/mpeg";
	if (kind === "text") return "text/plain;charset=utf-8";
	return "image/png";
};

const toErrorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return "请稍后重试。";
};
