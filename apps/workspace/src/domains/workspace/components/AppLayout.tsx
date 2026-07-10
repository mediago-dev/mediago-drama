import type React from "react";
import {
	SidebarContentLayout,
	useWorkspaceSidebarWidth,
	workspaceSidebarWidth,
} from "@/domains/workspace/components/SidebarContentLayout";
import { useDesktopWindowDrag as useDesktopWindowDragHandler } from "@/domains/workspace/lib/desktop-window-drag";

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
			className="desktop-window-frame h-screen w-screen"
			contentInset={!sidebarHidden}
			maxSidebarWidth={workspaceSidebarWidth.max}
			minSidebarWidth={workspaceSidebarWidth.min}
			resizeStep={workspaceSidebarWidth.resizeStep}
			showDesktopDragRegion
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
 * Interactive actions opt out of the drag region so they remain clickable.
 */
export const AppHeader: React.FC<AppHeaderProps> = ({ actions, title }) => {
	const startWindowDrag = useDesktopWindowDragHandler();

	return (
		<header
			className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-ide-toolbar/95 px-3 text-ide-toolbar-foreground"
			data-desktop-drag-region
			onPointerDown={startWindowDrag}
		>
			<div className="flex h-full min-w-0 flex-1 items-center">
				<h1 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h1>
			</div>
			{actions ? (
				<div className="flex shrink-0 items-center gap-2" data-desktop-no-drag>
					{actions}
				</div>
			) : null}
		</header>
	);
};

export { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
