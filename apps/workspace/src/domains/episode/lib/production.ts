import { parseTimeline } from "@/lib/markdown/video";
import type { MarkdownDocument } from "@/domains/documents/stores";

export type ProductionItemKind =
	| "character"
	| "scene"
	| "shot"
	| "asset"
	| "dialogue"
	| "voiceover"
	| "music"
	| "note";

export interface ProductionItem {
	id: string;
	kind: ProductionItemKind;
	title: string;
	summary: string;
	content: string;
	source: string;
}

export interface ProductionBoard {
	characters: ProductionItem[];
	scenes: ProductionItem[];
	shots: ProductionItem[];
	assets: ProductionItem[];
	dialogue: ProductionItem[];
	voiceover: ProductionItem[];
	music: ProductionItem[];
	notes: ProductionItem[];
}

interface MarkdownSection {
	level: number;
	title: string;
	content: string;
}

export const extractProductionBoard = (document: MarkdownDocument | null): ProductionBoard => {
	const emptyBoard = createEmptyBoard();
	if (!document) return emptyBoard;

	const sections = readSections(document.content);
	const board = sections.reduce((nextBoard, section, index) => {
		const kind = classifySection(section);
		if (!kind) return nextBoard;

		const item: ProductionItem = {
			id: `${kind}-${index}-${slugify(section.title)}`,
			kind,
			title: cleanTitle(section.title, kind),
			summary: summarizeSection(section.content),
			content: section.content,
			source: `H${section.level} ${section.title}`,
		};

		getBoardList(nextBoard, kind).push(item);
		return nextBoard;
	}, emptyBoard);

	for (const segment of parseTimeline(document.content)) {
		board.shots.push({
			id: `shot-video-${segment.id}`,
			kind: "shot",
			title: segment.title,
			summary: segment.visual || segment.audio || "来自源文档的视频块。",
			content: `\`\`\`video\nstart: ${segment.start}\nend: ${segment.end}\nvisual: ${segment.visual}\naudio: ${segment.audio}\n\`\`\``,
			source: "视频块",
		});
	}

	return board;
};

export const getProductionItemCount = (board: ProductionBoard) =>
	board.characters.length +
	board.scenes.length +
	board.shots.length +
	board.assets.length +
	board.dialogue.length +
	board.voiceover.length +
	board.music.length +
	board.notes.length;

const createEmptyBoard = (): ProductionBoard => ({
	characters: [],
	scenes: [],
	shots: [],
	assets: [],
	dialogue: [],
	voiceover: [],
	music: [],
	notes: [],
});

const getBoardList = (board: ProductionBoard, kind: ProductionItemKind) => {
	if (kind === "character") return board.characters;
	if (kind === "scene") return board.scenes;
	if (kind === "shot") return board.shots;
	if (kind === "asset") return board.assets;
	if (kind === "dialogue") return board.dialogue;
	if (kind === "voiceover") return board.voiceover;
	if (kind === "music") return board.music;
	return board.notes;
};

const readSections = (markdown: string): MarkdownSection[] => {
	const sections: MarkdownSection[] = [];
	let current: MarkdownSection | null = null;

	for (const line of markdown.split("\n")) {
		const match = line.match(/^(#{1,4})\s+(.+)$/);
		if (match?.[1] && match[2]) {
			if (current) sections.push(normalizeSection(current));
			current = {
				level: match[1].length,
				title: match[2].trim(),
				content: "",
			};
			continue;
		}

		if (current) current.content += `${line}\n`;
	}

	if (current) sections.push(normalizeSection(current));
	return sections;
};

const normalizeSection = (section: MarkdownSection): MarkdownSection => ({
	...section,
	content: section.content.trim(),
});

const classifySection = (section: MarkdownSection): ProductionItemKind | null => {
	const source = `${section.title}\n${section.content}`.toLowerCase();

	if (includesAny(source, ["角色", "character", "人物"])) return "character";
	if (includesAny(source, ["场景", "scene", "空间"])) return "scene";
	if (includesAny(source, ["分镜", "镜头", "shot", "storyboard"])) return "shot";
	if (includesAny(source, ["素材", "道具", "asset", "制作需求", "美术"])) return "asset";
	if (includesAny(source, ["台词", "对白", "dialogue"])) return "dialogue";
	if (includesAny(source, ["旁白", "voiceover", "vo"])) return "voiceover";
	if (includesAny(source, ["音乐", "音效", "music", "sound"])) return "music";
	if (includesAny(source, ["剪辑备注", "备注", "note"])) return "note";

	return null;
};

const cleanTitle = (title: string, kind: ProductionItemKind) => {
	const labels: Record<ProductionItemKind, string[]> = {
		character: ["角色", "角色设定", "人物", "character"],
		scene: ["场景", "场景设定", "scene"],
		shot: ["分镜", "镜头", "shot", "storyboard"],
		asset: ["素材需求", "素材", "道具", "asset"],
		dialogue: ["台词", "对白", "dialogue"],
		voiceover: ["旁白", "voiceover", "vo"],
		music: ["音乐建议", "音乐", "音效", "music"],
		note: ["剪辑备注", "备注", "note"],
	};
	const pattern = new RegExp(`^(${labels[kind].join("|")})\\s*[｜:：-]?\\s*`, "i");
	const cleaned = title.replace(pattern, "").trim();
	return cleaned || title;
};

const summarizeSection = (content: string) => {
	const withoutCode = content.replace(/```[\s\S]*?```/g, "").trim();
	const lines = withoutCode
		.split("\n")
		.map((line) => line.replace(/^[-*]\s*/, "").trim())
		.filter(Boolean);
	const summary = lines.slice(0, 3).join(" ");
	return summary || "从文档中提取的结构化项目。";
};

const includesAny = (value: string, keywords: string[]) =>
	keywords.some((keyword) => value.includes(keyword.toLowerCase()));

const slugify = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
		.replace(/^-|-$/g, "") || "item";
