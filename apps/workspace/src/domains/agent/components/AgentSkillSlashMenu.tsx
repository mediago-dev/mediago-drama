import { BookOpenCheck } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { orderSkillsForPrimaryFlows } from "@/domains/settings/lib/skill-order";
import "@/styles/tiptap-agent-skill-slash.css";

export interface AgentSkillSlashItem {
	description: string;
	hint?: Record<string, string>;
	name: string;
	overridden?: boolean;
	source?: string;
	templateId?: string;
	title?: string;
}

export interface AgentSkillSlashMenuPosition {
	left: number;
	placement: "bottom" | "top";
	top: number;
}

interface AgentSkillSlashMenuProps {
	errorMessage?: string;
	isLoading?: boolean;
	items: AgentSkillSlashItem[];
	onSelect: (item: AgentSkillSlashItem) => void;
	position: AgentSkillSlashMenuPosition;
	selectedIndex: number;
}

const maxAgentSkillSlashItems = 40;

export const AgentSkillSlashMenu: React.FC<AgentSkillSlashMenuProps> = ({
	errorMessage,
	isLoading = false,
	items,
	onSelect,
	position,
	selectedIndex,
}) => {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [canScrollDown, setCanScrollDown] = useState(false);

	const updateScrollHint = useCallback(() => {
		const node = scrollRef.current;
		if (!node) {
			setCanScrollDown(false);
			return;
		}
		const remainingScroll = node.scrollHeight - node.clientHeight - node.scrollTop;
		setCanScrollDown(remainingScroll > 1);
	}, []);

	useEffect(() => {
		const selectedElement = menuRef.current?.querySelector<HTMLElement>(
			".agent-skill-slash-option[data-selected='true']",
		);
		selectedElement?.scrollIntoView?.({ block: "nearest" });
		const frame = window.requestAnimationFrame(updateScrollHint);
		return () => window.cancelAnimationFrame(frame);
	}, [errorMessage, isLoading, items, selectedIndex, updateScrollHint]);

	if (typeof document === "undefined") return null;

	return createPortal(
		<div
			ref={menuRef}
			className="agent-skill-slash-menu-layer"
			data-placement={position.placement}
			role="presentation"
			style={{
				left: position.left,
				top: position.top,
			}}
			onClick={stopAgentSkillSlashEvent}
			onMouseDown={stopAgentSkillSlashEvent}
			onPointerDown={stopAgentSkillSlashEvent}
			onWheel={stopAgentSkillSlashEvent}
		>
			<div className="agent-skill-slash-menu" role="listbox" aria-label="Skill 列表">
				<div ref={scrollRef} className="agent-skill-slash-scroll" onScroll={updateScrollHint}>
					<div className="agent-skill-slash-heading">Skills</div>
					{isLoading ? (
						<div className="agent-skill-slash-empty">正在加载 Skill...</div>
					) : errorMessage ? (
						<div className="agent-skill-slash-empty">{errorMessage}</div>
					) : items.length === 0 ? (
						<div className="agent-skill-slash-empty">无匹配 Skill</div>
					) : (
						items.map((item, index) => {
							const selected = index === selectedIndex;

							return (
								<button
									key={item.name}
									type="button"
									className="agent-skill-slash-option"
									data-selected={selected ? "true" : "false"}
									role="option"
									aria-selected={selected}
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
										onSelect(item);
									}}
									onClick={stopAgentSkillSlashEvent}
								>
									<BookOpenCheck className="agent-skill-slash-icon" />
									<span className="agent-skill-slash-body">
										<span className="agent-skill-slash-title">{skillDisplayTitle(item)}</span>
										<span className="agent-skill-slash-meta">
											<span className="agent-skill-slash-command">/{item.name}</span>
											<span>{skillMetaLabel(item)}</span>
										</span>
										<span className="agent-skill-slash-description">
											{item.description || "暂无描述"}
										</span>
									</span>
								</button>
							);
						})
					)}
				</div>
				{canScrollDown ? (
					<div
						aria-hidden="true"
						className="agent-skill-slash-scroll-hint"
						data-agent-skill-scroll-hint
					/>
				) : null}
			</div>
		</div>,
		document.body,
	);
};

export const filterAgentSkillSlashItems = (items: AgentSkillSlashItem[], query: string) => {
	const normalizedQuery = normalizeAgentSkillSearchText(query);
	const orderedItems = orderSkillsForPrimaryFlows(items);
	if (!normalizedQuery) return orderedItems.slice(0, maxAgentSkillSlashItems);

	return orderedItems
		.filter((item) =>
			[
				item.name,
				item.title ?? "",
				item.description,
				item.templateId ?? "",
				item.source ?? "",
				...Object.values(item.hint ?? {}),
			].some((value) => normalizeAgentSkillSearchText(value).includes(normalizedQuery)),
		)
		.slice(0, maxAgentSkillSlashItems);
};

const stopAgentSkillSlashEvent = (event: React.SyntheticEvent) => {
	event.stopPropagation();
};

const skillDisplayTitle = (item: AgentSkillSlashItem) => item.title?.trim() || item.name;

const skillMetaLabel = (item: AgentSkillSlashItem) => {
	const source =
		item.source === "user" ? "自定义" : item.source === "pack" ? "内置" : item.source || "Skill";
	const override = item.overridden ? "已覆盖" : "";
	const template = item.templateId ? item.templateId : "";

	return [source, override, template].filter(Boolean).join(" · ");
};

const normalizeAgentSkillSearchText = (value: string) =>
	value.trim().toLocaleLowerCase("zh-Hans-CN");
