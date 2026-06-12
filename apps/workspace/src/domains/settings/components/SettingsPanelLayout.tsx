import type React from "react";
import { useTauriWindowDrag } from "@/domains/workspace/lib/tauri-window-drag";
import { cn } from "@/shared/lib/utils";

interface SettingsPanelLayoutProps {
	actions?: React.ReactNode;
	children: React.ReactNode;
	contentClassName?: string;
	description?: React.ReactNode;
	icon?: React.ReactNode;
	title: React.ReactNode;
}

export const SettingsPanelLayout: React.FC<SettingsPanelLayoutProps> = ({
	actions,
	children,
	contentClassName,
	description,
	icon,
	title,
}) => (
	<section className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
		<SettingsPanelHeader title={title} description={description} icon={icon} actions={actions} />
		<div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5", contentClassName)}>
			{children}
		</div>
	</section>
);

const SettingsPanelHeader: React.FC<{
	actions?: React.ReactNode;
	description?: React.ReactNode;
	icon?: React.ReactNode;
	title: React.ReactNode;
}> = ({ actions, description, icon, title }) => {
	const startWindowDrag = useTauriWindowDrag();

	return (
		<header
			className="shrink-0 border-b border-border bg-ide-editor px-5 py-4"
			onPointerDown={startWindowDrag}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1" data-tauri-drag-region>
					<div className="flex items-center gap-2">
						{icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
						<h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
					</div>
					{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
				</div>
				{actions ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2" data-tauri-no-drag>
						{actions}
					</div>
				) : null}
			</div>
		</header>
	);
};
