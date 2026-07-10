import { Plus, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { uploadMediaAsset } from "@/domains/workspace/api/media";
import { useProjectStore } from "@/domains/projects/stores";
import { apiResourceURL } from "@/shared/lib/api-base";
import { cn } from "@/shared/lib/utils";

// AgentFormImagesField renders an `images` form field: reference images as a
// deduplicated list of media asset ids. The agent may prefill defaults (e.g.
// the resource's finalized art); the user can upload more or remove any. The
// submitted value stays an id array — generate_media resolves the assets.
export const AgentFormImagesField: React.FC<{
	value: unknown;
	max?: number;
	disabled: boolean;
	projectId?: string;
	onChange: (value: string[]) => void;
	onBusyChange?: (busy: boolean) => void;
}> = ({ value, max, disabled, projectId, onChange, onBusyChange }) => {
	const ids = normalizeImageIds(value);
	// The upload loop reads the LATEST ids through this ref instead of the
	// render-time snapshot, so removing a thumbnail mid-batch can't be undone
	// by a later per-file commit.
	const idsRef = useRef(ids);
	useEffect(() => {
		idsRef.current = ids;
	});
	const inputRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState("");
	const full = typeof max === "number" && ids.length >= max;

	const addFiles = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const targetProjectId = projectId || useProjectStore.getState().activeProjectId || undefined;
		setUploading(true);
		onBusyChange?.(true);
		setError("");
		let dropped = 0;
		try {
			for (const file of Array.from(files)) {
				if (typeof max === "number" && idsRef.current.length >= max) {
					dropped += 1;
					continue;
				}
				const asset = await uploadMediaAsset(file, targetProjectId);
				if (idsRef.current.includes(asset.id)) continue;
				// Commit per file: a later failure must not discard assets that
				// already uploaded successfully.
				const next = [...idsRef.current, asset.id];
				idsRef.current = next;
				onChange(next);
			}
			if (dropped > 0) {
				setError(`已达上限 ${max} 张，${dropped} 个文件未上传。`);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "上传失败，请重试。");
		} finally {
			setUploading(false);
			onBusyChange?.(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	return (
		<div>
			<div className="flex flex-wrap items-center gap-1.5">
				{ids.map((id) => (
					<span
						key={id}
						className="group relative inline-flex size-14 overflow-hidden rounded-sm border border-border bg-background"
					>
						<img
							src={mediaAssetThumbnailURL(id)}
							alt=""
							className="size-full object-cover"
							loading="lazy"
						/>
						<button
							type="button"
							aria-label="移除参考图"
							disabled={disabled || uploading}
							className="absolute right-0.5 top-0.5 hidden cursor-pointer rounded-sm bg-background/80 p-0.5 text-foreground group-hover:inline-flex disabled:cursor-not-allowed"
							onClick={() => onChange(ids.filter((item) => item !== id))}
						>
							<X className="size-3" />
						</button>
					</span>
				))}
				<button
					type="button"
					disabled={disabled || uploading || full}
					className={cn(
						"inline-flex size-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-sm border border-dashed border-border bg-background text-caption text-muted-foreground transition-colors hover:bg-ide-list-hover",
						"disabled:cursor-not-allowed disabled:opacity-50",
					)}
					onClick={() => inputRef.current?.click()}
				>
					<Plus className="size-4" />
					{uploading ? "上传中" : "上传"}
				</button>
				<input
					ref={inputRef}
					type="file"
					accept="image/*"
					multiple
					className="hidden"
					onChange={(event) => void addFiles(event.target.files)}
				/>
			</div>
			{typeof max === "number" ? (
				<p className="mt-1 text-caption text-muted-foreground">
					{ids.length}/{max} 张
				</p>
			) : null}
			{error ? <p className="mt-1 text-error-foreground">{error}</p> : null}
		</div>
	);
};

export const normalizeImageIds = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const id = item.trim();
		if (id) seen.add(id);
	}
	return Array.from(seen);
};

const mediaAssetThumbnailURL = (assetId: string) =>
	apiResourceURL(`api/v1/media-assets/${encodeURIComponent(assetId)}/content`);
