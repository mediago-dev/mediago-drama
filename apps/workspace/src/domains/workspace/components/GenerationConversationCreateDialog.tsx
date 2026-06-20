import { AudioLines, FileText, Film, Image as ImageIcon, Plus } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { createCallable } from "react-call";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import type { StudioTab } from "./ProjectNavigatorTypes";

export interface GenerationConversationGroup {
	kind: StudioTab;
	label: string;
}

export interface GenerationConversationCreateResult {
	kind: StudioTab;
	title: string;
}

interface GenerationConversationCreateDialogProps {
	groups?: GenerationConversationGroup[];
	initialKind?: StudioTab;
}

const defaultConversationGroups: GenerationConversationGroup[] = [
	{ kind: "video", label: "视频生成" },
	{ kind: "image", label: "图片生成" },
	{ kind: "text", label: "文本生成" },
	{ kind: "audio", label: "音频生成" },
];

export const GenerationConversationCreateDialog = createCallable<
	GenerationConversationCreateDialogProps,
	GenerationConversationCreateResult | null
>(({ call, groups = defaultConversationGroups, initialKind = "video" }) => {
	const [kind, setKind] = useState<StudioTab>(initialKind);
	const [title, setTitle] = useState("");
	const trimmedTitle = title.trim();
	const kindLabel = conversationKindLabel(kind);

	useEffect(() => {
		setKind(initialKind);
		setTitle("");
	}, [initialKind]);

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!trimmedTitle) return;
		call.end({ kind, title: trimmedTitle });
	};

	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open) call.end(null);
			}}
		>
			<AlertDialogContent className="max-w-md">
				<form onSubmit={submit}>
					<AlertDialogHeader>
						<AlertDialogTitle>新建会话</AlertDialogTitle>
						<AlertDialogDescription>选择生成类型并填写会话名称。</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="my-4 grid gap-3">
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">生成类型</span>
							<Select value={kind} onValueChange={(value) => setKind(value as StudioTab)}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{groups.map((group) => (
										<SelectItem key={group.kind} value={group.kind}>
											<span className="inline-flex items-center gap-2">
												{conversationKindIcon(group.kind)}
												<span>{group.label}</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</label>
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">会话名称</span>
							<Input
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder={`${kindLabel}探索`}
								autoFocus
							/>
						</label>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>取消</AlertDialogCancel>
						<Button type="submit" disabled={!trimmedTitle}>
							<Plus />
							<span>创建</span>
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
});
GenerationConversationCreateDialog.displayName = "GenerationConversationCreateDialog";

export const openGenerationConversationCreateDialog = (
	props: GenerationConversationCreateDialogProps,
) => GenerationConversationCreateDialog.call(props);

const conversationKindLabel = (kind: StudioTab) => {
	switch (kind) {
		case "text":
			return "文本生成";
		case "audio":
			return "音频生成";
		case "video":
			return "视频生成";
		default:
			return "图片生成";
	}
};

const conversationKindIcon = (kind: StudioTab) => {
	switch (kind) {
		case "text":
			return <FileText className="size-3.5" />;
		case "audio":
			return <AudioLines className="size-3.5" />;
		case "video":
			return <Film className="size-3.5" />;
		default:
			return <ImageIcon className="size-3.5" />;
	}
};
