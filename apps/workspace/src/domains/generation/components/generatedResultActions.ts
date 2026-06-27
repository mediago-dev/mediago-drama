import { useCallback, useMemo, useState } from "react";
import { mutate as mutateSWR } from "swr";
import type { KeyedMutator } from "swr";
import type { GenerationAsset } from "@/domains/generation/api/generation";
import { entryPromptText } from "@/domains/generation/components/mediaGenerationHelpers";
import {
	generationAssetSelectionKey,
	generationAssetSource,
	type GenerationEntry,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import type { MediaAssetsResponse } from "@/domains/workspace/api/media";
import { uploadProjectAsset } from "@/domains/workspace/api/project-assets";
import { getWorkspaceDocuments, workspaceDocumentsKey } from "@/domains/workspace/api/workspace";
import { useDocumentsStore } from "@/domains/documents/stores";
import {
	copyLocalFileToDirectory,
	downloadFilename,
	downloadLocalFileWithDirectoryPicker,
} from "@/domains/workspace/lib/downloads";
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
			if (savingKeySet.has(key)) return;

			const source = generationAssetSource(asset);
			if (!source) {
				toast.error("保存失败", { description: "生成结果没有可保存的文件地址。" });
				return;
			}

			markSaving(key, true);
			try {
				const savedPath = await downloadGeneratedAssetToDirectory(
					asset,
					source,
					asset.title?.trim() || fallbackAssetFilename(entry, asset),
				);
				if (!savedPath) return;

				toast.success("文件已保存", { description: savedPath });
			} catch (error) {
				toast.error("保存失败", { description: toErrorMessage(error) });
			} finally {
				markSaving(key, false);
			}
		},
		[markSaving, savingKeySet, toast],
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
	const filename = downloadFilename({
		fallback: fallbackFilename,
		kind: asset.kind,
		mimeType: type,
		title: fallbackFilename,
	});
	return new File([blob], filename, { type });
};

export const downloadGeneratedAssetToDirectory = async (
	asset: GenerationAsset,
	_source: string,
	fallbackFilename: string,
	options: { directory?: string | null } = {},
): Promise<string | null> => {
	const type = asset.mimeType || defaultMimeType(asset.kind);
	const title = asset.title?.trim() || fallbackFilename;
	if (asset.downloadPath?.trim()) {
		const payload = {
			fallback: fallbackFilename,
			kind: asset.kind,
			mimeType: type,
			sourcePath: asset.downloadPath,
			title,
		};
		const saved = options.directory
			? await copyLocalFileToDirectory({ ...payload, directory: options.directory })
			: await downloadLocalFileWithDirectoryPicker(payload);
		return saved?.path ?? null;
	}

	throw new Error(`生成结果“${title}”缺少本地文件路径，无法复制到下载位置。`);
};

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
