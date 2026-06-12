import { LayoutGrid, Loader2, RefreshCcw } from "lucide-react";
import type React from "react";
import useSWR from "swr";
import { Button } from "@/shared/components/ui/button";
import { capabilitiesKey, getCapabilities } from "../api/capabilities";

interface CapabilityGridProps {
	projectId?: string;
	projectMode: boolean;
	showHeader?: boolean;
}

export const CapabilityGrid: React.FC<CapabilityGridProps> = ({
	projectId,
	projectMode,
	showHeader = true,
}) => {
	const { data, error, isLoading, mutate } = useSWR(capabilitiesKey, getCapabilities);
	const capabilities = data?.capabilities ?? [];
	const visibleCapabilities = capabilities.filter((record) => record.status !== "hidden");

	return (
		<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
			<div className="mx-auto flex max-w-6xl flex-col gap-5">
				{showHeader ? (
					<header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
						<div className="min-w-0">
							<h1 className="text-base font-semibold text-foreground">能力工具箱</h1>
							<p className="mt-1 text-xs text-muted-foreground">
								{projectMode && projectId ? "当前项目能力" : "全局创作能力"}
							</p>
						</div>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => void mutate()}
							disabled={isLoading}
						>
							{isLoading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
							刷新
						</Button>
					</header>
				) : null}

				{error ? (
					<div className="rounded-sm border border-error-border bg-error-surface px-4 py-3 text-sm text-error-foreground">
						能力清单加载失败
					</div>
				) : null}

				{isLoading && visibleCapabilities.length === 0 ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						<span>加载中</span>
					</div>
				) : null}

				{isLoading ? null : (
					<section className="rounded-sm border border-border bg-card px-4 py-6 text-foreground">
						<div className="flex items-center gap-2">
							<LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
							<h2 className="text-sm font-semibold">未选择工具</h2>
						</div>
						<p className="mt-2 text-xs leading-5 text-muted-foreground">
							从左侧工具列表选择图片、视频或文本生成，进入对应的创作 session。
						</p>
					</section>
				)}
			</div>
		</div>
	);
};
