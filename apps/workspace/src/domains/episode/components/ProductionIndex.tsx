import {
	Captions,
	Clapperboard,
	Save,
	MessageSquareText,
	Music2,
	PackageSearch,
	ScrollText,
	StickyNote,
	Users,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Textarea } from "@/shared/components/ui/textarea";
import {
	getProductionItemCount,
	type ProductionBoard,
	type ProductionItem,
} from "@/domains/episode/lib/production";

interface ProductionIndexProps {
	board: ProductionBoard;
	onUpdateItem?: (item: ProductionItem, content: string) => void;
}

const groups: Array<{
	key: keyof ProductionBoard;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}> = [
	{ key: "characters", label: "角色", icon: Users },
	{ key: "scenes", label: "场景", icon: ScrollText },
	{ key: "shots", label: "分镜", icon: Clapperboard },
	{ key: "assets", label: "素材", icon: PackageSearch },
	{ key: "dialogue", label: "台词", icon: Captions },
	{ key: "voiceover", label: "旁白", icon: MessageSquareText },
	{ key: "music", label: "音乐", icon: Music2 },
	{ key: "notes", label: "剪辑备注", icon: StickyNote },
];

export const ProductionIndex: React.FC<ProductionIndexProps> = ({ board, onUpdateItem }) => {
	const total = getProductionItemCount(board);

	return (
		<section className="flex h-full min-h-0 flex-col bg-ide-panel">
			<header className="border-b border-border bg-ide-toolbar px-2 py-2">
				<div className="flex items-center justify-between gap-2">
					<div className="min-w-0">
						<p className="text-xs font-medium text-muted-foreground">结构化提取</p>
						<h2 className="truncate text-sm font-semibold text-foreground">制作看板</h2>
					</div>
					<Badge variant="secondary">{total} 项</Badge>
				</div>
			</header>

			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
				{groups.map((group) => (
					<ProductionGroup
						key={group.key}
						icon={group.icon}
						label={group.label}
						items={board[group.key]}
						onUpdateItem={onUpdateItem}
					/>
				))}
			</div>
		</section>
	);
};

interface ProductionGroupProps {
	icon: React.ComponentType<{ className?: string }>;
	items: ProductionItem[];
	label: string;
	onUpdateItem?: (item: ProductionItem, content: string) => void;
}

const ProductionGroup: React.FC<ProductionGroupProps> = ({
	icon: Icon,
	items,
	label,
	onUpdateItem,
}) => (
	<section>
		<div className="mb-1.5 flex items-center justify-between gap-2">
			<div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
				<Icon className="size-3.5" />
				<span>{label}</span>
			</div>
			<Badge variant="outline">{items.length}</Badge>
		</div>
		<div className="space-y-1.5">
			{items.length > 0 ? (
				items
					.slice(0, 4)
					.map((item) => <ProductionCard key={item.id} item={item} onUpdateItem={onUpdateItem} />)
			) : (
				<p className="border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground">
					暂无提取项。
				</p>
			)}
		</div>
	</section>
);

interface ProductionCardProps {
	item: ProductionItem;
	onUpdateItem?: (item: ProductionItem, content: string) => void;
}

const ProductionCard: React.FC<ProductionCardProps> = ({ item, onUpdateItem }) => {
	const [isEditing, setIsEditing] = useState(false);
	const [content, setContent] = useState(item.content || item.summary);

	const save = () => {
		onUpdateItem?.(item, content);
		setIsEditing(false);
	};

	return (
		<article className="border border-border bg-ide-editor p-2">
			<div className="flex items-center justify-between gap-2">
				<h3 className="min-w-0 truncate text-xs font-medium text-foreground">{item.title}</h3>
				<span className="shrink-0 text-caption text-muted-foreground">{item.source}</span>
			</div>
			{isEditing ? (
				<div className="mt-2 space-y-2">
					<Textarea
						value={content}
						onChange={(event) => setContent(event.target.value)}
						className="min-h-24 resize-none rounded-sm text-xs shadow-none"
					/>
					<div className="flex justify-end gap-1.5">
						<Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
							取消
						</Button>
						<Button type="button" size="sm" onClick={save}>
							<Save />
							<span>保存到文档</span>
						</Button>
					</div>
				</div>
			) : (
				<>
					<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
						{item.summary}
					</p>
					{onUpdateItem ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="mt-2 px-2"
							onClick={() => setIsEditing(true)}
						>
							编辑源内容
						</Button>
					) : null}
				</>
			)}
		</article>
	);
};
