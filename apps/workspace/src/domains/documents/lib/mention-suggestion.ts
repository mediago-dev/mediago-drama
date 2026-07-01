import {
	createElement,
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ChevronRight,
	File,
	FileCode2,
	FileImage,
	FileVideo,
	Hash,
	Plus,
	type LucideIcon,
} from "lucide-react";
import { ReactRenderer } from "@tiptap/react";
import type {
	SuggestionKeyDownProps,
	SuggestionOptions,
	SuggestionProps,
} from "@tiptap/suggestion";
import tippy, { type Instance, type Props as TippyProps } from "tippy.js";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { AgentReference } from "@/domains/agent/api/agent";
import type { SelectedGenerationAsset } from "@/domains/generation/api/generation";
import { generationAssetSource } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { openMentionSectionCreateDialog } from "@/domains/documents/components/MentionSectionCreateDialog";
import {
	openMentionSectionTargetDialog,
	type MentionSectionTargetCategory,
} from "@/domains/documents/components/MentionSectionTargetDialog";
import type { ProjectAsset } from "@/domains/workspace/api/project-assets";
import {
	documentCategoryDescriptorMap,
	documentCategoryDescriptors,
} from "@/domains/documents/lib/categories";
import {
	createSectionBlockId,
	findMarkdownSectionEndLine,
	listDocumentSections,
	normalizeHeadingText,
	sectionIdBeforeHeadingLine,
} from "@/domains/documents/lib/sections";
import {
	appendSecondLevelHeading,
	mentionCreateLabelForCategory,
	normalizeMentionSectionTitle,
} from "@/domains/documents/lib/mention-section-create";
import {
	type DocumentCategory,
	legacySourceMaterialDocumentCategory,
	type MarkdownDocument,
	referenceDocumentCategory,
	useDocumentsStore,
} from "@/domains/documents/stores";
import { apiResourceURL } from "@/shared/lib/api-base";

export interface AgentMentionItem {
	assetId?: string;
	assetKind?: ProjectAsset["kind"];
	blockId?: string;
	category: DocumentCategory;
	documentId: string;
	documentTitle: string;
	id: string;
	mimeType?: string;
	kind: AgentReference["kind"];
	label: string;
	level?: number;
	previewUrl?: string;
	title: string;
	url?: string;
}

interface MentionListHandle {
	onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MentionListProps {
	command: (item: AgentMentionItem) => void;
	items: AgentMentionItem[];
	onCreateSection?: (group: AgentMentionGroup) => Promise<void> | void;
	onCreateSectionFromQuery?: (query: string) => Promise<void> | void;
	query?: string;
}

interface AgentMentionGroup {
	category: DocumentCategory;
	documentId?: string;
	icon: LucideIcon;
	id: string;
	isAssetGroup?: boolean;
	items: AgentMentionItem[];
	label: string;
	meta: string;
}

interface AgentMentionPoint {
	x: number;
	y: number;
}

interface AgentMentionRect {
	bottom: number;
	left: number;
	right: number;
	top: number;
}

interface AgentMentionSafeTriangleInput {
	activeRect?: AgentMentionRect | null;
	origin?: AgentMentionPoint | null;
	point: AgentMentionPoint;
	submenuRect?: AgentMentionRect | null;
}

export interface MentionSuggestionOptions {
	getSelectedGenerationAssets?: () => readonly SelectedGenerationAsset[];
	selectedGenerationAssets?: readonly SelectedGenerationAsset[];
}

export const fallbackMentionCategory: DocumentCategory = "reference";

const maxMentionItems = 100;
const maxDocumentMentionItems = 72;
const maxAssetMentionItems = 28;
const mentionSafeTriangleEdgePadding = 8;
const mentionSafeTriangleHoverIntentMs = 180;
const categoryOrder = new Map<DocumentCategory, number>(
	documentCategoryDescriptors.map((descriptor, index) => [descriptor.key, index]),
);
const fallbackMentionDescriptor = documentCategoryDescriptorMap[fallbackMentionCategory];

export const AgentMentionList = forwardRef<MentionListHandle, MentionListProps>(
	function AgentMentionList(
		{ command, items, onCreateSection, onCreateSectionFromQuery, query = "" },
		ref,
	) {
		const groups = useMemo(() => createMentionGroups(items), [items]);
		const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
		const [selectedItemIndex, setSelectedItemIndex] = useState(0);
		const primaryMenuRef = useRef<HTMLDivElement | null>(null);
		const secondaryMenuRef = useRef<HTMLDivElement | null>(null);
		const groupButtonRefs = useRef(new Map<string, HTMLButtonElement>());
		const secondaryPaneRef = useRef<HTMLDivElement | null>(null);
		const safeTriangleOriginRef = useRef<{
			groupId: string;
			point: AgentMentionPoint;
		} | null>(null);
		const groupActivationIntentTimerRef = useRef<number | null>(null);
		const [primaryMenuCanScrollDown, setPrimaryMenuCanScrollDown] = useState(false);
		const [secondaryMenuCanScrollDown, setSecondaryMenuCanScrollDown] = useState(false);
		const normalizedQuery = useMemo(() => normalizeMentionSectionTitle(query), [query]);
		const activeGroup = groups[selectedGroupIndex] ?? groups[0];
		const activeItems = activeGroup?.items ?? [];
		const canCreateSection = Boolean(
			activeGroup?.documentId && !activeGroup.isAssetGroup && onCreateSection,
		);
		const activeOptionCount = activeItems.length + (canCreateSection ? 1 : 0);

		useEffect(() => {
			setSelectedGroupIndex(0);
			setSelectedItemIndex(0);
			safeTriangleOriginRef.current = null;
			const timer = groupActivationIntentTimerRef.current;
			if (timer !== null) {
				window.clearTimeout(timer);
				groupActivationIntentTimerRef.current = null;
			}
		}, [items]);

		const updatePrimaryMenuScrollHint = useCallback(() => {
			const node = primaryMenuRef.current;
			if (!node) {
				setPrimaryMenuCanScrollDown(false);
				return;
			}
			const remainingScroll = node.scrollHeight - node.clientHeight - node.scrollTop;
			setPrimaryMenuCanScrollDown(remainingScroll > 1);
		}, []);

		const updateSecondaryMenuScrollHint = useCallback(() => {
			const node = secondaryMenuRef.current;
			if (!node) {
				setSecondaryMenuCanScrollDown(false);
				return;
			}
			const remainingScroll = node.scrollHeight - node.clientHeight - node.scrollTop;
			setSecondaryMenuCanScrollDown(remainingScroll > 1);
		}, []);

		useEffect(() => {
			const frame = window.requestAnimationFrame(() => {
				updatePrimaryMenuScrollHint();
				updateSecondaryMenuScrollHint();
			});
			return () => window.cancelAnimationFrame(frame);
		}, [
			activeGroup?.id,
			activeItems.length,
			canCreateSection,
			groups.length,
			updatePrimaryMenuScrollHint,
			updateSecondaryMenuScrollHint,
		]);

		useEffect(() => {
			const frame = window.requestAnimationFrame(() => {
				if (secondaryMenuRef.current) {
					secondaryMenuRef.current.scrollTop = 0;
				}
				updateSecondaryMenuScrollHint();
			});
			return () => window.cancelAnimationFrame(frame);
		}, [activeGroup?.id, updateSecondaryMenuScrollHint]);

		useEffect(() => {
			return () => {
				const timer = groupActivationIntentTimerRef.current;
				if (timer !== null) {
					window.clearTimeout(timer);
					groupActivationIntentTimerRef.current = null;
				}
			};
		}, []);

		const clearGroupActivationIntent = () => {
			const timer = groupActivationIntentTimerRef.current;
			if (timer !== null) {
				window.clearTimeout(timer);
				groupActivationIntentTimerRef.current = null;
			}
		};

		const clearSafeTriangle = () => {
			clearGroupActivationIntent();
			safeTriangleOriginRef.current = null;
		};

		const rememberActiveGroupPointer = (groupId: string, point: AgentMentionPoint) => {
			clearGroupActivationIntent();
			safeTriangleOriginRef.current = { groupId, point };
		};

		const activateGroup = (index: number) => {
			setSelectedGroupIndex(index);
			setSelectedItemIndex(0);
			clearSafeTriangle();
		};

		const activateGroupFromPointer = (index: number, point: AgentMentionPoint) => {
			const group = groups[index];
			if (!group) return;
			setSelectedGroupIndex(index);
			setSelectedItemIndex(0);
			rememberActiveGroupPointer(group.id, point);
		};

		const shouldPreserveActiveGroup = (point: AgentMentionPoint) => {
			const activeGroupId = activeGroup?.id ?? "";
			const activeButton = activeGroupId ? groupButtonRefs.current.get(activeGroupId) : null;
			const origin =
				safeTriangleOriginRef.current?.groupId === activeGroupId
					? safeTriangleOriginRef.current.point
					: null;

			return shouldKeepAgentMentionGroupActive({
				activeRect: activeButton?.getBoundingClientRect(),
				origin,
				point,
				submenuRect: secondaryPaneRef.current?.getBoundingClientRect(),
			});
		};

		const scheduleGroupActivationIntent = (index: number, point: AgentMentionPoint) => {
			clearGroupActivationIntent();
			groupActivationIntentTimerRef.current = window.setTimeout(() => {
				groupActivationIntentTimerRef.current = null;
				activateGroupFromPointer(index, point);
			}, mentionSafeTriangleHoverIntentMs);
		};

		const handleGroupPointerEnter = (
			group: AgentMentionGroup,
			index: number,
			event: { clientX: number; clientY: number },
		) => {
			const point = mentionPointerEventPoint(event);
			if (group.id === activeGroup?.id) {
				rememberActiveGroupPointer(group.id, point);
				return;
			}

			if (shouldPreserveActiveGroup(point)) {
				scheduleGroupActivationIntent(index, point);
				return;
			}

			activateGroupFromPointer(index, point);
		};

		const handleGroupPointerMove = (
			group: AgentMentionGroup,
			index: number,
			event: { clientX: number; clientY: number },
		) => {
			const point = mentionPointerEventPoint(event);
			if (group.id === activeGroup?.id) {
				rememberActiveGroupPointer(group.id, point);
				return;
			}

			if (shouldPreserveActiveGroup(point)) {
				scheduleGroupActivationIntent(index, point);
				return;
			}

			activateGroupFromPointer(index, point);
		};

		useImperativeHandle(
			ref,
			() => ({
				onKeyDown: ({ event }) => {
					if (items.length === 0) {
						if (event.key !== "Enter" || !normalizedQuery || !onCreateSectionFromQuery) {
							return false;
						}
						void onCreateSectionFromQuery(normalizedQuery);
						return true;
					}
					if (groups.length === 0 || activeOptionCount === 0) return false;

					if (event.key === "ArrowUp") {
						setSelectedItemIndex((index) => (index + activeOptionCount - 1) % activeOptionCount);
						return true;
					}

					if (event.key === "ArrowDown") {
						setSelectedItemIndex((index) => (index + 1) % activeOptionCount);
						return true;
					}

					if (event.key === "ArrowLeft") {
						clearSafeTriangle();
						setSelectedGroupIndex((index) => {
							const nextIndex = (index + groups.length - 1) % groups.length;
							return nextIndex;
						});
						setSelectedItemIndex(0);
						return true;
					}

					if (event.key === "ArrowRight") {
						clearSafeTriangle();
						setSelectedGroupIndex((index) => (index + 1) % groups.length);
						setSelectedItemIndex(0);
						return true;
					}

					if (event.key === "Enter") {
						if (canCreateSection && selectedItemIndex === activeItems.length && activeGroup) {
							void onCreateSection?.(activeGroup);
							return true;
						}
						const selectedItem = activeItems[selectedItemIndex] ?? activeItems[0];
						if (selectedItem) command(selectedItem);
						return true;
					}

					return false;
				},
			}),
			[
				activeGroup,
				activeItems,
				activeOptionCount,
				canCreateSection,
				command,
				groups.length,
				items.length,
				normalizedQuery,
				onCreateSectionFromQuery,
				onCreateSection,
				selectedItemIndex,
				clearSafeTriangle,
			],
		);

		if (items.length === 0) {
			return createElement(
				"div",
				{ className: "agent-mention-menu-empty" },
				normalizedQuery ? `无匹配引用，按 Enter 新增「${normalizedQuery}」` : "无匹配引用",
			);
		}

		let previousSourceCategory: DocumentCategory | null = null;

		return createElement(
			"div",
			{
				className: "agent-mention-cascader",
				onMouseLeave: clearSafeTriangle,
				onPointerLeave: clearSafeTriangle,
			},
			createElement(
				"div",
				{ className: "agent-mention-cascader-pane agent-mention-cascader-primary-pane" },
				createElement(
					"div",
					{
						ref: primaryMenuRef,
						className: "agent-mention-menu agent-mention-cascader-primary",
						onScroll: updatePrimaryMenuScrollHint,
					},
					createElement("div", { className: "agent-mention-pane-label" }, "文档"),
					groups.map((group, index) => {
						const showCategory = group.category !== previousSourceCategory;
						previousSourceCategory = group.category;

						return createElement(
							"div",
							{ key: group.id },
							showCategory
								? createElement(
										"div",
										{ className: "agent-mention-source-group" },
										mentionCategoryDescriptor(group.category).label,
									)
								: null,
							createElement(
								"button",
								{
									type: "button",
									ref: (node: HTMLButtonElement | null) => {
										if (node) {
											groupButtonRefs.current.set(group.id, node);
										} else {
											groupButtonRefs.current.delete(group.id);
										}
									},
									className: "agent-mention-source",
									"data-category": group.category,
									"data-selected": index === selectedGroupIndex ? "true" : "false",
									onFocus: () => activateGroup(index),
									onMouseDown: (event) => {
										event.preventDefault();
									},
									onMouseEnter: (event) => handleGroupPointerEnter(group, index, event),
									onMouseMove: (event) => handleGroupPointerMove(group, index, event),
									onPointerEnter: (event) => handleGroupPointerEnter(group, index, event),
									onPointerMove: (event) => handleGroupPointerMove(group, index, event),
								},
								createElement(group.icon, { className: "agent-mention-source-icon" }),
								createElement(
									"span",
									{ className: "agent-mention-source-body" },
									createElement("span", { className: "agent-mention-source-title" }, group.label),
									createElement("span", { className: "agent-mention-source-meta" }, group.meta),
								),
								createElement(ChevronRight, { className: "agent-mention-source-chevron" }),
							),
						);
					}),
				),
				primaryMenuCanScrollDown
					? createElement("div", {
							"aria-hidden": "true",
							className: "agent-mention-scroll-hint agent-mention-scroll-hint-primary",
							"data-agent-mention-primary-scroll-hint": "",
						})
					: null,
			),
			createElement(
				"div",
				{
					ref: secondaryPaneRef,
					className: "agent-mention-cascader-pane agent-mention-cascader-secondary-pane",
					onMouseEnter: clearSafeTriangle,
					onPointerEnter: clearSafeTriangle,
				},
				createElement(
					"div",
					{
						ref: secondaryMenuRef,
						className: "agent-mention-menu agent-mention-cascader-secondary",
						onScroll: updateSecondaryMenuScrollHint,
						role: "listbox",
					},
					createElement("div", { className: "agent-mention-pane-label" }, "文档与节点"),
					activeItems.map((item, index) =>
						renderMentionOption(item, index, selectedItemIndex, {
							command,
							setSelectedItemIndex,
						}),
					),
					canCreateSection && activeGroup
						? renderCreateSectionOption(activeGroup, selectedItemIndex === activeItems.length, {
								onCreateSection,
								setSelectedItemIndex,
								targetIndex: activeItems.length,
							})
						: null,
				),
				secondaryMenuCanScrollDown
					? createElement("div", {
							"aria-hidden": "true",
							className: "agent-mention-scroll-hint agent-mention-scroll-hint-secondary",
							"data-agent-mention-secondary-scroll-hint": "",
						})
					: null,
			),
		);
	},
);

const mentionPointerEventPoint = (event: {
	clientX: number;
	clientY: number;
}): AgentMentionPoint => ({
	x: event.clientX,
	y: event.clientY,
});

export const shouldKeepAgentMentionGroupActive = ({
	activeRect,
	origin,
	point,
	submenuRect,
}: AgentMentionSafeTriangleInput) => {
	if (!activeRect || !origin || !submenuRect) return false;
	if (origin.y < activeRect.top - mentionSafeTriangleEdgePadding) return false;
	if (origin.y > activeRect.bottom + mentionSafeTriangleEdgePadding) return false;
	if (point.x <= origin.x) return false;
	if (point.x >= submenuRect.left) return false;

	return pointInAgentMentionTriangle(
		point,
		origin,
		{
			x: submenuRect.left,
			y: submenuRect.top - mentionSafeTriangleEdgePadding,
		},
		{
			x: submenuRect.left,
			y: submenuRect.bottom + mentionSafeTriangleEdgePadding,
		},
	);
};

const pointInAgentMentionTriangle = (
	point: AgentMentionPoint,
	first: AgentMentionPoint,
	second: AgentMentionPoint,
	third: AgentMentionPoint,
) => {
	const firstSign = agentMentionTriangleSign(point, first, second);
	const secondSign = agentMentionTriangleSign(point, second, third);
	const thirdSign = agentMentionTriangleSign(point, third, first);
	const hasNegative = firstSign < 0 || secondSign < 0 || thirdSign < 0;
	const hasPositive = firstSign > 0 || secondSign > 0 || thirdSign > 0;
	return !(hasNegative && hasPositive);
};

const agentMentionTriangleSign = (
	first: AgentMentionPoint,
	second: AgentMentionPoint,
	third: AgentMentionPoint,
) => (first.x - third.x) * (second.y - third.y) - (second.x - third.x) * (first.y - third.y);

const renderCreateSectionOption = (
	group: AgentMentionGroup,
	selected: boolean,
	actions: {
		onCreateSection?: (group: AgentMentionGroup) => Promise<void> | void;
		setSelectedItemIndex: (index: number) => void;
		targetIndex: number;
	},
) =>
	createElement(
		"button",
		{
			key: `${group.id}:create`,
			type: "button",
			className: "agent-mention-create",
			"data-category": group.category,
			"data-selected": selected ? "true" : "false",
			onMouseEnter: () => actions.setSelectedItemIndex(actions.targetIndex),
			onMouseDown: (event) => {
				event.preventDefault();
				void actions.onCreateSection?.(group);
			},
		},
		createElement(Plus, { className: "agent-mention-create-icon" }),
		createElement(
			"span",
			{ className: "agent-mention-create-title" },
			mentionCreateLabelForCategory(group.category),
		),
	);

const renderMentionOption = (
	item: AgentMentionItem,
	index: number,
	selectedItemIndex: number,
	actions: {
		command: (item: AgentMentionItem) => void;
		setSelectedItemIndex: (index: number) => void;
	},
) => {
	const descriptor = mentionCategoryDescriptor(item.category);
	const Icon =
		item.kind === "document"
			? File
			: item.kind === "section"
				? Hash
				: item.kind === "asset"
					? assetMentionIcon(item.assetKind)
					: descriptor.icon;
	const selected = index === selectedItemIndex;
	const previewUrl = item.kind === "document" ? undefined : item.previewUrl;

	return createElement(
		"button",
		{
			key: item.id,
			type: "button",
			className: "agent-mention-option",
			"data-category": item.category,
			"data-has-preview": previewUrl ? "true" : "false",
			"data-kind": item.kind,
			"data-selected": selected ? "true" : "false",
			role: "option",
			"aria-selected": selected,
			onMouseEnter: () => actions.setSelectedItemIndex(index),
			onMouseDown: (event) => {
				event.preventDefault();
				actions.command(item);
			},
		},
		createElement(Icon, { className: "agent-mention-option-icon" }),
		createElement(
			"span",
			{ className: "agent-mention-option-body" },
			createElement("span", { className: "agent-mention-option-title" }, item.title),
			createElement("span", { className: "agent-mention-option-meta" }, mentionItemMeta(item)),
		),
		previewUrl
			? createElement("img", {
					alt: "",
					className: "agent-mention-option-preview",
					src: apiResourceURL(previewUrl),
				})
			: null,
	);
};

const createMentionGroups = (items: AgentMentionItem[]): AgentMentionGroup[] => {
	const groups: AgentMentionGroup[] = [];
	const groupById = new Map<string, AgentMentionGroup>();

	for (const item of items) {
		const id = item.kind === "asset" ? "asset:project-assets" : `document:${item.documentId}`;
		let group = groupById.get(id);

		if (!group) {
			const descriptor = mentionCategoryDescriptor(item.category);
			group = {
				category: item.category,
				documentId: item.kind === "asset" ? undefined : item.documentId,
				icon: item.kind === "asset" ? FileImage : descriptor.icon,
				id,
				isAssetGroup: item.kind === "asset",
				items: [],
				label: item.kind === "asset" ? "项目素材" : item.documentTitle,
				meta: item.kind === "asset" ? "素材" : descriptor.label,
			};
			groupById.set(id, group);
			groups.push(group);
		}

		group.items.push(item);
	}

	return groups;
};

export function createMentionSuggestion(
	options: MentionSuggestionOptions = {},
): Omit<SuggestionOptions<AgentMentionItem, AgentMentionItem>, "editor"> {
	let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null;
	let popup: Instance<TippyProps> | null = null;

	const listProps = (props: SuggestionProps<AgentMentionItem, AgentMentionItem>) => ({
		command: props.command,
		items: props.items,
		onCreateSection: (group: AgentMentionGroup) => {
			popup?.hide();
			return createSectionFromGroup(group, props.command);
		},
		onCreateSectionFromQuery: (query: string) => {
			popup?.hide();
			return createSectionFromQuery(query, props.command);
		},
		query: props.query,
	});

	return {
		allowSpaces: true,
		allowedPrefixes: null,
		char: "@",
		items: ({ query }) => createMentionItems(query, options),
		render: () => ({
			onStart: (props) => {
				component = new ReactRenderer(AgentMentionList, {
					editor: props.editor,
					props: listProps(props),
				});

				const appendTarget = mentionPopupAppendTarget(props.editor.view.dom);

				popup = tippy(document.body, {
					appendTo: () => appendTarget,
					content: component.element,
					getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
					hideOnClick: true,
					interactive: true,
					maxWidth: "none",
					placement: "bottom-start",
					showOnCreate: true,
					trigger: "manual",
					zIndex: 60,
				});
			},
			onUpdate: (props) => {
				component?.updateProps(listProps(props));
				popup?.setProps({
					getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(),
				});
			},
			onKeyDown: (props) => {
				if (props.event.key === "Escape") {
					popup?.hide();
					return true;
				}

				return component?.ref?.onKeyDown(props) ?? false;
			},
			onExit: () => {
				popup?.destroy();
				component?.destroy();
				popup = null;
				component = null;
			},
		}),
	};
}

export const mentionPopupAppendTarget = (editorElement: Element | null): HTMLElement => {
	const ownerDocument = editorElement?.ownerDocument ?? document;
	const popupRoot = editorElement?.closest<HTMLElement>(
		"[data-agent-mention-popup-root], [role='dialog']",
	);

	return popupRoot ?? ownerDocument.body;
};

const createSectionFromGroup = async (
	group: AgentMentionGroup,
	command: (item: AgentMentionItem) => void,
) => {
	if (!group.documentId || group.isAssetGroup) return;

	const document = useDocumentsStore
		.getState()
		.documents.find((item) => item.id === group.documentId);
	if (!document) return;

	const result = await openMentionSectionCreateDialog({
		createLabel: mentionCreateLabelForCategory(group.category),
		documentTitle: document.title,
	});
	const title = normalizeMentionSectionTitle(result?.title ?? "");
	if (!title) return;

	createSectionInDocument(document, normalizeMentionCategory(document.category), title, command);
};

const createSectionFromQuery = async (
	rawTitle: string,
	command: (item: AgentMentionItem) => void,
) => {
	const title = normalizeMentionSectionTitle(rawTitle);
	if (!title) return;

	const result = await openMentionSectionTargetDialog({ title });
	if (!result) return;

	const targetDocument = mentionTargetDocumentForCategory(result.category);
	if (targetDocument) {
		createSectionInDocument(targetDocument, result.category, title, command);
		return;
	}

	const content = appendSecondLevelHeading("", title);
	const previousActiveDocumentId = useDocumentsStore.getState().activeDocumentId;
	const createdDocument = useDocumentsStore.getState().createDocument({
		category: result.category,
		content,
	});
	if (!createdDocument) return;

	if (previousActiveDocumentId && previousActiveDocumentId !== createdDocument.id) {
		useDocumentsStore.getState().selectDocument(previousActiveDocumentId);
	}

	const createdItem = createdSectionMentionItem(
		{ ...createdDocument, content },
		result.category,
		title,
	);
	if (createdItem) command(createdItem);
};

const mentionTargetDocumentForCategory = (category: MentionSectionTargetCategory) =>
	[...useDocumentsStore.getState().documents]
		.filter((document) => normalizeMentionCategory(document.category) === category)
		.sort(compareDocuments)[0] ?? null;

const createSectionInDocument = (
	document: MarkdownDocument,
	category: DocumentCategory,
	title: string,
	command: (item: AgentMentionItem) => void,
) => {
	const nextContent = appendSecondLevelHeading(document.content, title);
	if (nextContent === document.content) return;

	useDocumentsStore.getState().updateDocumentContent(document.id, nextContent);

	const createdItem = createdSectionMentionItem(
		{ ...document, content: nextContent },
		category,
		title,
	);
	if (createdItem) command(createdItem);
};

const createdSectionMentionItem = (
	document: MarkdownDocument,
	category: DocumentCategory,
	title: string,
): AgentMentionItem | null => {
	const normalizedTitle = normalizeHeadingText(title);
	const section = [...mentionSectionsForDocument(document)]
		.reverse()
		.find((item) => normalizeHeadingText(item.title) === normalizedTitle);
	if (!section) return null;

	return {
		blockId: section.blockId,
		category,
		documentId: document.id,
		documentTitle: document.title,
		id: `${document.id}:${section.blockId}`,
		kind: "section",
		label: section.title,
		level: section.level,
		title: section.title,
	};
};

export const createMentionItems = (
	query: string,
	options: MentionSuggestionOptions = {},
): AgentMentionItem[] => {
	const normalizedQuery = query.trim().toLowerCase();
	const documents = [...useDocumentsStore.getState().documents].sort(compareDocuments);
	const assets = [...useDocumentsStore.getState().assets].sort(compareAssets);
	const selectedGenerationAssets = mentionSuggestionSelectedGenerationAssets(options);
	const documentItems: AgentMentionItem[] = [];
	const assetItems: AgentMentionItem[] = [];

	for (const document of documents) {
		if (documentItems.length >= maxDocumentMentionItems) break;

		const category = normalizeMentionCategory(document.category);
		const docMatches = matchesMentionQuery(document.title, normalizedQuery);
		const sections = mentionSectionsForDocument(document);
		const sectionPreviewUrls = sectionPreviewUrlMap(document);
		const matchingSections = sections.filter(
			(section) => docMatches || matchesMentionQuery(section.title, normalizedQuery),
		);

		if (docMatches || matchingSections.length > 0) {
			documentItems.push(documentMentionItem(document, category));
		}

		for (const section of matchingSections) {
			if (documentItems.length >= maxDocumentMentionItems) break;

			documentItems.push({
				blockId: section.blockId,
				category,
				documentId: document.id,
				documentTitle: document.title,
				id: `${document.id}:${section.blockId}`,
				kind: "section",
				label: section.title,
				level: section.level,
				previewUrl:
					sectionPreviewUrls.get(section.blockId) ??
					selectedGenerationPreviewUrlForSection(
						selectedGenerationAssets,
						document,
						category,
						section.blockId,
					),
				title: section.title,
			});
		}
	}

	for (const asset of assets) {
		if (assetItems.length >= maxAssetMentionItems) break;
		if (!matchesMentionQuery(asset.filename, normalizedQuery)) continue;

		assetItems.push({
			assetId: asset.id,
			assetKind: asset.kind,
			category: fallbackMentionCategory,
			documentId: asset.id,
			documentTitle: asset.filename,
			id: `asset:${asset.id}`,
			kind: "asset",
			label: asset.filename,
			mimeType: asset.mimeType,
			previewUrl: asset.kind === "image" ? asset.url : undefined,
			title: asset.filename,
			url: asset.url,
		});
	}

	return [...documentItems, ...assetItems].slice(0, maxMentionItems);
};

const documentMentionItem = (
	document: MarkdownDocument,
	category: DocumentCategory,
): AgentMentionItem => ({
	category,
	documentId: document.id,
	documentTitle: document.title,
	id: document.id,
	kind: "document",
	label: document.title,
	title: document.title,
});

const mentionSectionsForDocument = (document: MarkdownDocument) => {
	const sections = listDocumentSections(document);
	if (sections.length <= 1) return sections;

	const [firstSection, ...restSections] = sections;
	if (
		firstSection?.level === 1 &&
		normalizeHeadingText(firstSection.title) === normalizeHeadingText(document.title)
	) {
		return restSections;
	}

	return sections;
};

export const compareDocuments = (a: MarkdownDocument, b: MarkdownDocument) => {
	const categoryDiff =
		(categoryOrder.get(normalizeMentionCategory(a.category)) ?? 0) -
		(categoryOrder.get(normalizeMentionCategory(b.category)) ?? 0);
	if (categoryDiff !== 0) return categoryDiff;

	return a.title.localeCompare(b.title, "zh-Hans-CN") || a.id.localeCompare(b.id, "zh-Hans-CN");
};

export const mentionItemMeta = (item: AgentMentionItem) => {
	if (item.kind === "asset") return `素材 · ${assetKindLabel(item.assetKind)}`;
	if (item.kind === "document") return mentionCategoryDescriptor(item.category).label;

	return `${item.documentTitle} · H${item.level ?? 1}`;
};

export const referenceFromMentionNode = (node: ProseMirrorNode): AgentReference | null => {
	const kind =
		node.attrs.kind === "section" ? "section" : node.attrs.kind === "asset" ? "asset" : "document";
	const documentId = stringAttribute(node.attrs.documentId);
	const title = stringAttribute(node.attrs.title) || stringAttribute(node.attrs.label);
	if (!documentId || !title) return null;

	if (kind === "asset") {
		const assetId = stringAttribute(node.attrs.assetId) || documentId;
		return {
			kind,
			documentId: assetId,
			assetId,
			assetKind: stringAttribute(node.attrs.assetKind),
			mimeType: stringAttribute(node.attrs.mimeType),
			title,
			category: fallbackMentionCategory,
			url: stringAttribute(node.attrs.url),
		};
	}

	const blockId = kind === "section" ? stringAttribute(node.attrs.blockId) : undefined;
	const category = documentCategory(node.attrs.category);

	return {
		kind,
		documentId,
		...(blockId ? { blockId } : {}),
		title,
		...(category ? { category } : {}),
	};
};

export const documentCategory = (value: unknown): DocumentCategory | undefined => {
	if (typeof value !== "string") return undefined;
	if (value === legacySourceMaterialDocumentCategory) return referenceDocumentCategory;
	return documentCategoryDescriptors.some((descriptor) => descriptor.key === value)
		? (value as DocumentCategory)
		: undefined;
};

export const mentionDisplayText = (value: unknown) => `@${String(value ?? "").trim()}`;

export const renderDataAttribute = (name: string, value: unknown) => {
	const text = stringAttribute(value);
	return text ? { [name]: text } : {};
};

export const stringAttribute = (value: unknown) => (typeof value === "string" ? value : "");

const mentionSuggestionSelectedGenerationAssets = (options: MentionSuggestionOptions) =>
	options.getSelectedGenerationAssets?.() ?? options.selectedGenerationAssets ?? [];

const selectedGenerationPreviewCategories = new Set<SelectedGenerationAsset["resourceType"]>([
	"character",
	"scene",
	"storyboard",
	"prop",
]);

const selectedGenerationPreviewUrlForSection = (
	assets: readonly SelectedGenerationAsset[],
	document: MarkdownDocument,
	category: DocumentCategory,
	blockId: string,
) => {
	if (
		assets.length === 0 ||
		!selectedGenerationPreviewCategories.has(category as SelectedGenerationAsset["resourceType"])
	) {
		return undefined;
	}

	const documentId = document.id.trim();
	const sectionBlockId = blockId.trim();
	const resourceType = category as SelectedGenerationAsset["resourceType"];

	for (const asset of assets) {
		if (asset.kind !== "image" || asset.resourceType !== resourceType) continue;
		if (!selectedGenerationAssetMatchesSection(asset, documentId, sectionBlockId)) continue;

		const source =
			generationAssetSource({
				base64: asset.base64,
				kind: asset.kind,
				mimeType: asset.mimeType,
				url: asset.url,
			}) || selectedGenerationAssetMediaURL(asset);
		if (source) return source;
	}

	return undefined;
};

const selectedGenerationAssetMatchesSection = (
	asset: SelectedGenerationAsset,
	documentId: string,
	blockId: string,
) => {
	const sourceDocumentId = asset.sourceDocumentId?.trim() ?? "";
	if (documentId && sourceDocumentId && sourceDocumentId !== documentId) return false;

	const resourceId = asset.resourceId?.trim() ?? "";
	if (blockId && resourceId) return resourceId === blockId;
	if (blockId) return sourceDocumentId === documentId;

	return sourceDocumentId === documentId || (!sourceDocumentId && !resourceId);
};

const selectedGenerationAssetMediaURL = (asset: SelectedGenerationAsset) =>
	asset.mediaAssetId
		? `/api/v1/media-assets/${encodeURIComponent(asset.mediaAssetId)}/content`
		: "";

const sectionPreviewUrlMap = (document: MarkdownDocument) => {
	const previews = new Map<string, string>();
	const lines = document.content.split(/\r?\n/);
	const occurrenceByHeading = new Map<string, number>();
	const seenSectionIds = new Set<string>();

	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(#{1,3})\s+(.+)$/.exec(lines[index]);
		if (!match) continue;

		const level = match[1].length;
		const title = normalizeHeadingText(match[2]);
		if (!title) continue;

		const key = `${level}|${title}`;
		const occurrence = (occurrenceByHeading.get(key) ?? 0) + 1;
		occurrenceByHeading.set(key, occurrence);

		const sectionId = sectionIdBeforeHeadingLine(lines, index);
		const blockId =
			sectionId && !seenSectionIds.has(sectionId)
				? sectionId
				: createSectionBlockId(document.id, level, occurrence, title);
		if (sectionId && !seenSectionIds.has(sectionId)) {
			seenSectionIds.add(sectionId);
		}

		const sectionEnd = findMarkdownSectionEndLine(lines, index, level);
		const previewUrl = firstImageSourceFromMarkdown(lines.slice(index + 1, sectionEnd).join("\n"));
		if (previewUrl) previews.set(blockId, previewUrl);
	}

	return previews;
};

const firstImageSourceFromMarkdown = (markdown: string) => {
	for (const line of markdown.split(/\r?\n/)) {
		const image = markdownImageFromLine(line.trim());
		if (!image || isPlaceholderImage(image)) continue;

		return image.source;
	}

	return undefined;
};

const markdownImageFromLine = (line: string) => {
	const match = /^!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)$/.exec(line);
	if (!match) return null;

	return {
		alt: match[1] ?? "",
		source: match[2] ?? match[3] ?? "",
	};
};

const isPlaceholderImage = (image: { alt: string; source: string }) =>
	["mediago-drama-section-image-pending:", "media-cli-section-image-pending:"].some((prefix) =>
		image.alt.startsWith(prefix),
	) ||
	Boolean(image.source.startsWith("mediago-drama-section-image-pending:")) ||
	Boolean(image.source.startsWith("media-cli-section-image-pending:")) ||
	(image.alt === "正在生成图片" && image.source.startsWith("data:image/svg+xml;base64,"));

const normalizeMentionCategory = (category: MarkdownDocument["category"]): DocumentCategory =>
	documentCategory(category) ?? fallbackMentionCategory;

const mentionCategoryDescriptor = (category: DocumentCategory) =>
	documentCategoryDescriptorMap[category] ?? fallbackMentionDescriptor;

const matchesMentionQuery = (value: string, normalizedQuery: string) =>
	normalizedQuery === "" || value.toLowerCase().includes(normalizedQuery);

const compareAssets = (a: ProjectAsset, b: ProjectAsset) => {
	const sortDiff = a.sortOrder - b.sortOrder;
	if (sortDiff !== 0) return sortDiff;
	return a.filename.localeCompare(b.filename, "zh-Hans-CN");
};

const assetMentionIcon = (kind?: ProjectAsset["kind"]) => {
	switch (kind) {
		case "image":
			return FileImage;
		case "video":
			return FileVideo;
		case "text":
			return FileCode2;
		default:
			return File;
	}
};

const assetKindLabel = (kind?: ProjectAsset["kind"]) => {
	switch (kind) {
		case "image":
			return "图片";
		case "video":
			return "视频";
		case "audio":
			return "音频";
		case "text":
			return "文本";
		default:
			return "文件";
	}
};
