import { AudioLines, FileText, Film, Image as ImageIcon, KeyRound, Loader2 } from "lucide-react";
import type React from "react";
import type { GenerationKind } from "@/domains/generation/api/generation";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { kindLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export const InspectorHeading: React.FC<{
	description?: string;
	title: string;
}> = ({ description, title }) => (
	<div className="mb-4">
		<p className="text-sm font-semibold text-foreground">{title}</p>
		{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
	</div>
);

export const GenerationSetupNotice: React.FC<{
	isLoading: boolean;
	kind: GenerationKind;
	onSettingsClick: () => void;
}> = ({ isLoading, kind, onSettingsClick }) => (
	<Alert className="rounded-md">
		{isLoading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
		<AlertTitle>{isLoading ? "正在加载模型供应商" : "暂无已配置供应商"}</AlertTitle>
		<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
			<span>
				{isLoading
					? "正在检查已配置的 API Key。"
					: `生成前请先为${kindLabel(kind)}供应商配置 API Key。`}
			</span>
			{isLoading ? null : (
				<Button type="button" variant="outline" size="sm" onClick={onSettingsClick}>
					<KeyRound className="size-4" />
					<span>设置</span>
				</Button>
			)}
		</AlertDescription>
	</Alert>
);

export const ModeToggle: React.FC<{
	compact?: boolean;
	kind: GenerationKind;
	onChange: (kind: GenerationKind) => void;
}> = ({ compact, kind, onChange }) => (
	<Tabs
		value={kind}
		onValueChange={(value) => onChange(value as GenerationKind)}
		className={compact ? undefined : "w-full"}
	>
		<TabsList className={cn("grid grid-cols-4", compact ? "w-auto" : "w-full")}>
			<TabsTrigger value="image" className={compact ? "px-2" : undefined}>
				<ImageIcon className="size-4" />
				{compact ? null : <span>图像</span>}
			</TabsTrigger>
			<TabsTrigger value="text" className={compact ? "px-2" : undefined}>
				<FileText className="size-4" />
				{compact ? null : <span>文本</span>}
			</TabsTrigger>
			<TabsTrigger value="video" className={compact ? "px-2" : undefined}>
				<Film className="size-4" />
				{compact ? null : <span>视频</span>}
			</TabsTrigger>
			<TabsTrigger value="audio" className={compact ? "px-2" : undefined}>
				<AudioLines className="size-4" />
				{compact ? null : <span>音频</span>}
			</TabsTrigger>
		</TabsList>
	</Tabs>
);
