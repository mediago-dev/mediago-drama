import type React from "react";
import {
	SidebarContentLayout,
	useWorkspaceSidebarWidth,
	workspaceSidebarWidth,
} from "@/domains/workspace/components/SidebarContentLayout";
import { useTauriWindowDrag as useTauriWindowDragHandler } from "@/domains/workspace/lib/tauri-window-drag";

interface AppLayoutProps {
	children: React.ReactNode;
	headerActions?: React.ReactNode;
	headerTitle: React.ReactNode;
	showHeader?: boolean;
	sidebar: React.ReactNode;
	sidebarHidden?: boolean;
}

/**
 * AppLayout is the product shell: left sidebar, right header, and content body.
 * Page-specific components should contribute sidebar screens and header actions,
 * but they should not recreate this two-column frame.
 */
export const AppLayout: React.FC<AppLayoutProps> = ({
	children,
	headerActions,
	headerTitle,
	showHeader = true,
	sidebar,
	sidebarHidden = false,
}) => {
	const [navigatorWidth, setNavigatorWidth] = useWorkspaceSidebarWidth();

	return (
		<SidebarContentLayout
			className="tauri-window-frame h-screen w-screen"
			contentInset={!sidebarHidden}
			maxSidebarWidth={workspaceSidebarWidth.max}
			minSidebarWidth={workspaceSidebarWidth.min}
			resizeStep={workspaceSidebarWidth.resizeStep}
			sidebar={sidebar}
			sidebarClassName="text-ide-sidebar-foreground"
			sidebarHidden={sidebarHidden}
			sidebarWidth={navigatorWidth}
			onSidebarWidthChange={setNavigatorWidth}
		>
			<div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
				{showHeader ? <AppHeader title={headerTitle} actions={headerActions} /> : null}
				<div className="min-h-0 flex-1 overflow-hidden">{children}</div>
			</div>
		</SidebarContentLayout>
	);
};

interface AppHeaderProps {
	actions?: React.ReactNode;
	title: React.ReactNode;
}

/**
 * AppHeader is the draggable title bar for the right content area.
 * The action slot is intentionally outside the drag handle so buttons remain clickable.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({ actions, title }) => {
	const startWindowDrag = useTauriWindowDragHandler();

	return (
		<header
			className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-ide-toolbar/95 px-3 text-ide-toolbar-foreground"
			onPointerDown={startWindowDrag}
		>
			<div className="flex h-full min-w-0 flex-1 items-center" data-tauri-drag-region>
				<h1 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h1>
			</div>
			{actions ? (
				<div className="flex shrink-0 items-center gap-2" data-tauri-no-drag>
					{actions}
				</div>
			) : null}
		</header>
	);
};

export { useTauriWindowDrag } from "@/domains/workspace/lib/tauri-window-drag";
