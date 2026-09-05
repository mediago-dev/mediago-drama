import type {
	ProjectProductionGraph,
	ProjectQCResult,
	ProjectShotRecord,
	ProjectVersionRecord,
} from "@/domains/projects/api/projects";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";

export interface CreatorMediaItem {
	id: string;
	kind: "image" | "video";
	source: string;
	title: string;
}

export interface CreatorShotView {
	shot: ProjectShotRecord;
	assets: SelectedGenerationAsset[];
	references: SelectedGenerationAsset[];
	media: CreatorMediaItem[];
	versions: ProjectVersionRecord[];
	qc: ProjectQCResult[];
	dependencies: ProjectProductionGraph["edges"];
}

export interface CreatorWorkspaceViewModel {
	shots: CreatorShotView[];
	activeShot?: CreatorShotView;
}

export const buildCreatorWorkspaceView = (input: {
	shots?: ProjectShotRecord[];
	graph?: ProjectProductionGraph;
	versions?: ProjectVersionRecord[];
	qcResults?: Record<string, ProjectQCResult>;
	assets?: SelectedGenerationAsset[];
	activeShotId?: string | null;
}): CreatorWorkspaceViewModel => {
	const graph = input.graph ?? { nodes: [], edges: [], updatedAt: "" };
	const allAssets = input.assets ?? [];
	const views = [...(input.shots ?? [])]
		.sort((left, right) => left.sequence - right.sequence)
		.map((shot) => {
			const assetIds = new Set(shot.assetIds ?? []);
			const assets = allAssets.filter(
				(asset) => assetIds.has(asset.id) || assetIds.has(asset.mediaAssetId ?? ""),
			);
			const references = allAssets.filter((asset) => asset.shotIds?.includes(shot.id));
			const shotNodes = graph.nodes.filter(
				(node) => node.shotId === shot.id || node.metadata?.shotId === shot.id,
			);
			const media = shotNodes.flatMap<CreatorMediaItem>((node) => {
				if (node.type !== "frame" && node.type !== "video" && node.type !== "asset") return [];
				const source = node.path?.trim();
				if (!source) return [];
				return [
					{
						id: node.id,
						kind: node.type === "video" ? "video" : "image",
						source,
						title: node.title,
					},
				];
			});
			for (const asset of [...assets, ...references]) {
				const source = generationAssetSource(asset);
				if (!source || media.some((item) => item.source === source)) continue;
				media.push({
					id: asset.id,
					kind: asset.kind === "video" ? "video" : "image",
					source,
					title: asset.title || asset.resourceTitle || shot.shotCode,
				});
			}
			return {
				shot,
				assets,
				references,
				media,
				versions: (input.versions ?? []).filter(
					(version) => version.entityId === shot.id || version.referenceIds?.includes(shot.id),
				),
				qc: Object.values(input.qcResults ?? {}).filter((result) => result.entityId === shot.id),
				dependencies: graph.edges.filter((edge) =>
					shotNodes.some((node) => node.id === edge.from || node.id === edge.to),
				),
			};
		});
	return {
		shots: views,
		activeShot: views.find((view) => view.shot.id === input.activeShotId) ?? views[0],
	};
};
