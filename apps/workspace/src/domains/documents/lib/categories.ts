import {
	Clapperboard,
	FileInput,
	Film,
	ScrollText,
	UserRound,
	type LucideIcon,
} from "lucide-react";
import type { DocumentCategory, MarkdownDocument } from "@/domains/documents/stores";
import { isOverviewDocumentId } from "@/lib/overview/overview-template";

export interface DocumentCategoryDescriptor {
	key: DocumentCategory;
	label: string;
	icon: LucideIcon;
	colorVar: string;
}

// The array order is the intentional overview section order.
export const documentCategoryDescriptors: readonly DocumentCategoryDescriptor[] = [
	{ key: "screenplay", label: "剧本", icon: ScrollText, colorVar: "--doc-category-screenplay" },
	{ key: "character", label: "角色", icon: UserRound, colorVar: "--doc-category-character" },
	{ key: "scene", label: "场景", icon: Clapperboard, colorVar: "--doc-category-scene" },
	{ key: "storyboard", label: "分镜", icon: Film, colorVar: "--doc-category-storyboard" },
	{
		key: "source-material",
		label: "素材",
		icon: FileInput,
		colorVar: "--doc-category-source-material",
	},
] as const;

export const documentCategoryIconMap = Object.fromEntries(
	documentCategoryDescriptors.map((descriptor) => [descriptor.key, descriptor.icon]),
) as Record<DocumentCategory, LucideIcon>;

export const documentCategoryDescriptorMap = Object.fromEntries(
	documentCategoryDescriptors.map((descriptor) => [descriptor.key, descriptor]),
) as Record<DocumentCategory, DocumentCategoryDescriptor>;

// Legacy uncategorized documents are shown under source material.
export const documentsForCategory = (
	documents: MarkdownDocument[],
	key: DocumentCategory,
): MarkdownDocument[] =>
	documents.filter(
		(document) =>
			!isOverviewDocumentId(document.id) &&
			(key === "source-material"
				? document.category === "source-material" || document.category == null
				: document.category === key),
	);
