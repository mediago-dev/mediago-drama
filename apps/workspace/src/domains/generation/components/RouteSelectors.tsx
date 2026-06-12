import { FileText, Film, Image as ImageIcon } from "lucide-react";
import type React from "react";
import type {
	GenerationFamily,
	GenerationKind,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { routeProviderLabel } from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export const RouteSelectors: React.FC<{
	compact?: boolean;
	extraField?: React.ReactNode;
	families: GenerationFamily[];
	kind: GenerationKind;
	onFamilyChange: (value: string) => void;
	onKindChange: (kind: GenerationKind) => void;
	onRouteChange: (value: string) => void;
	onVersionChange: (value: string) => void;
	routes: GenerationRoute[];
	selectedFamily: GenerationFamily;
	selectedRoute: GenerationRoute;
	selectedVersion: GenerationVersion;
	showKindToggle?: boolean;
	versions: GenerationVersion[];
}> = ({
	compact,
	extraField,
	families,
	kind,
	onFamilyChange,
	onKindChange,
	onRouteChange,
	onVersionChange,
	routes,
	selectedFamily,
	selectedRoute,
	selectedVersion,
	showKindToggle = true,
	versions,
}) => {
	const kindSelector = (
		<div>
			<Label className="mb-2 block text-xs text-muted-foreground">模式</Label>
			<ModeToggle kind={kind} onChange={onKindChange} />
		</div>
	);
	const familySelector = (
		<div>
			<Label className="mb-2 block text-xs text-muted-foreground">模型类型</Label>
			<Select value={selectedFamily.id} onValueChange={onFamilyChange}>
				<SelectTrigger aria-label="模型类型" className="h-9 rounded-md text-foreground">
					<SelectValue placeholder="模型类型" />
				</SelectTrigger>
				<SelectContent align="start">
					{families.map((family) => (
						<SelectItem key={family.id} value={family.id}>
							{family.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
	const versionSelector = (
		<div>
			<Label className="mb-2 block text-xs text-muted-foreground">模型输入</Label>
			<Select value={selectedVersion.id} onValueChange={onVersionChange}>
				<SelectTrigger aria-label="具体模型" className="h-9 rounded-md text-foreground">
					<SelectValue placeholder="模型输入" />
				</SelectTrigger>
				<SelectContent align="start">
					{versions.map((versionItem) => (
						<SelectItem key={versionItem.id} value={versionItem.id}>
							{versionItem.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
	const routeSelector = (
		<div>
			<Label className="mb-2 block text-xs text-muted-foreground">供应商</Label>
			<Select value={selectedRoute.id} onValueChange={onRouteChange}>
				<SelectTrigger aria-label="生成供应商" className="h-9 rounded-md text-foreground">
					<SelectValue placeholder="供应商" />
				</SelectTrigger>
				<SelectContent align="start">
					{routes.map((routeItem) => (
						<SelectItem
							key={routeItem.id}
							value={routeItem.id}
							disabled={routeItem.status !== "available"}
						>
							{routeProviderLabel(routeItem)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);

	return (
		<div
			className={cn(
				"grid gap-4",
				compact ? "grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))]" : undefined,
			)}
		>
			{showKindToggle ? kindSelector : null}
			{familySelector}
			{versionSelector}
			{routeSelector}
			{extraField}
		</div>
	);
};

const ModeToggle: React.FC<{
	compact?: boolean;
	kind: GenerationKind;
	onChange: (kind: GenerationKind) => void;
}> = ({ compact, kind, onChange }) => (
	<Tabs
		value={kind}
		onValueChange={(value) => onChange(value as GenerationKind)}
		className={compact ? undefined : "w-full"}
	>
		<TabsList className={cn("grid grid-cols-3", compact ? "w-auto" : "w-full")}>
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
		</TabsList>
	</Tabs>
);
