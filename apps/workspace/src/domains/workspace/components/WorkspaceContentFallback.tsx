import type React from "react";

export const WorkspaceContentFallback: React.FC = () => (
	<div
		className="h-full min-h-0 overflow-hidden bg-ide-editor text-ide-editor-foreground"
		role="status"
		aria-label="加载内容"
	>
		<div className="mx-auto flex h-full w-full max-w-6xl flex-col px-4 py-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div className="h-3 w-28 animate-pulse rounded-sm bg-muted" />
				<div className="flex items-center gap-1.5">
					<div className="size-8 animate-pulse rounded-sm bg-muted" />
					<div className="size-8 animate-pulse rounded-sm bg-muted" />
				</div>
			</div>
			<div className="h-9 w-full max-w-lg animate-pulse rounded-sm bg-muted" />
			<div className="mt-7 space-y-3">
				<div className="h-4 w-full animate-pulse rounded-sm bg-muted" />
				<div className="h-4 w-[92%] animate-pulse rounded-sm bg-muted" />
				<div className="h-4 w-[78%] animate-pulse rounded-sm bg-muted" />
				<div className="h-4 w-[88%] animate-pulse rounded-sm bg-muted" />
				<div className="h-4 w-[64%] animate-pulse rounded-sm bg-muted" />
			</div>
		</div>
	</div>
);
