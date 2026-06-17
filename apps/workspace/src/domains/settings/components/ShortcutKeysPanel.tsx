import { Keyboard } from "lucide-react";
import { Fragment } from "react";
import type React from "react";
import { SettingsPanelLayout } from "@/domains/settings/components/SettingsPanelLayout";
import { cn } from "@/shared/lib/utils";

type ShortcutChord = readonly string[];

interface ShortcutItem {
	chords: readonly ShortcutChord[];
	context: string;
	label: string;
}

interface ShortcutGroup {
	items: readonly ShortcutItem[];
	label: string;
}

const shortcutGroups: readonly ShortcutGroup[] = [
	{
		label: "工作区",
		items: [
			{
				label: "新建项目",
				context: "项目列表",
				chords: [
					["⌘", "N"],
					["Ctrl", "N"],
				],
			},
			{
				label: "打开搜索",
				context: "全局或当前项目",
				chords: [
					["⌘", "K"],
					["Ctrl", "K"],
				],
			},
		],
	},
	{
		label: "搜索与弹窗",
		items: [
			{ label: "上一个结果", context: "搜索弹窗", chords: [["↑"]] },
			{ label: "下一个结果", context: "搜索弹窗", chords: [["↓"]] },
			{ label: "打开结果", context: "搜索弹窗", chords: [["Enter"]] },
			{ label: "关闭弹窗", context: "搜索、菜单、对话框", chords: [["Esc"]] },
		],
	},
	{
		label: "编辑输入",
		items: [
			{ label: "发送", context: "智能体输入框、评论输入框", chords: [["Enter"]] },
			{ label: "换行", context: "智能体输入框、评论输入框", chords: [["Shift", "Enter"]] },
		],
	},
	{
		label: "提示菜单",
		items: [
			{ label: "上一个选项", context: "提示词斜杠菜单", chords: [["↑"]] },
			{ label: "下一个选项", context: "提示词斜杠菜单", chords: [["↓"]] },
			{
				label: "插入选项",
				context: "提示词斜杠菜单",
				chords: [["Enter"], ["Tab"]],
			},
		],
	},
];

export const ShortcutKeysPanel: React.FC = () => (
	<SettingsPanelLayout
		title="快捷键"
		description="查看当前工作区可用的键盘操作。"
		icon={<Keyboard className="size-4" />}
	>
		<div className="max-w-3xl space-y-5">
			{shortcutGroups.map((group) => (
				<section key={group.label} className="space-y-2" aria-labelledby={shortcutGroupId(group)}>
					<h3
						id={shortcutGroupId(group)}
						className="px-1 text-xs font-semibold text-muted-foreground"
					>
						{group.label}
					</h3>
					<div className="divide-y divide-border rounded-md border border-border bg-ide-toolbar/40">
						{group.items.map((item) => (
							<ShortcutRow key={`${group.label}-${item.label}`} item={item} />
						))}
					</div>
				</section>
			))}
		</div>
	</SettingsPanelLayout>
);

const ShortcutRow: React.FC<{ item: ShortcutItem }> = ({ item }) => (
	<div className="grid gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
		<div className="min-w-0">
			<p className="text-sm font-medium text-foreground">{item.label}</p>
			<p className="mt-0.5 truncate text-xs text-muted-foreground">{item.context}</p>
		</div>
		<div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
			{item.chords.map((chord, index) => (
				<Fragment key={`${item.label}-${chord.join("-")}`}>
					{index > 0 ? <span className="text-2xs text-muted-foreground">或</span> : null}
					<ShortcutChordView chord={chord} />
				</Fragment>
			))}
		</div>
	</div>
);

const ShortcutChordView: React.FC<{ chord: ShortcutChord }> = ({ chord }) => (
	<span className="inline-flex items-center gap-1" aria-label={chord.join(" ")}>
		{chord.map((key, index) => (
			<Fragment key={`${key}-${index}`}>
				{index > 0 ? <span className="text-2xs text-muted-foreground">+</span> : null}
				<kbd
					className={cn(
						"inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border",
						"bg-ide-editor px-1.5 font-mono text-[11px] font-semibold leading-none text-foreground shadow-sm",
					)}
				>
					{key}
				</kbd>
			</Fragment>
		))}
	</span>
);

const shortcutGroupId = (group: ShortcutGroup) => `shortcut-group-${group.label}`;
