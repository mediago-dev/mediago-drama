import {
	AudioLines,
	Bell,
	CheckCheck,
	Film,
	Image as ImageIcon,
	type LucideIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	type GenerationNotificationOpenKind,
	type GenerationSuccessNotification,
	useGenerationNotificationStore,
} from "@/domains/generation/stores/generation-notifications";
import { markAllGenerationNotificationsRead } from "@/domains/generation/api/generation";
import { cn } from "@/shared/lib/utils";

interface GenerationNotificationButtonProps {
	onOpenNotification: (notification: GenerationSuccessNotification) => void;
}

export const GenerationNotificationButton: React.FC<GenerationNotificationButtonProps> = ({
	onOpenNotification,
}) => {
	const notifications = useGenerationNotificationStore((state) => state.notifications);
	const markAllRead = useGenerationNotificationStore((state) => state.markAllRead);
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const pendingOpenFrameRef = useRef<number | null>(null);
	const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(null);
	const unreadCount = useMemo(
		() => notifications.filter((notification) => !notification.readAt).length,
		[notifications],
	);
	const markAllNotificationsRead = useCallback(() => {
		markAllRead();
		void markAllGenerationNotificationsRead();
	}, [markAllRead]);
	const updatePopoverPosition = useCallback(() => {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;

		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const width = Math.min(352, Math.max(0, viewportWidth - 32));
		const left = Math.min(
			Math.max(16, rect.right - width),
			Math.max(16, viewportWidth - width - 16),
		);
		const bottom = Math.max(16, viewportHeight - rect.top + 8);
		const maxHeight = Math.max(160, Math.min(384, rect.top - 24));

		const nextStyle: React.CSSProperties = {
			bottom,
			left,
			maxHeight,
			width,
		};
		setPopoverStyle((current) => (samePopoverStyle(current, nextStyle) ? current : nextStyle));
	}, []);
	const openNotificationAfterClose = useCallback(
		(notification: GenerationSuccessNotification) => {
			setOpen(false);
			if (pendingOpenFrameRef.current !== null) {
				cancelAnimationFrame(pendingOpenFrameRef.current);
			}
			pendingOpenFrameRef.current = requestAnimationFrame(() => {
				pendingOpenFrameRef.current = null;
				onOpenNotification(notification);
			});
		},
		[onOpenNotification],
	);

	useEffect(
		() => () => {
			if (pendingOpenFrameRef.current !== null) {
				cancelAnimationFrame(pendingOpenFrameRef.current);
			}
		},
		[],
	);

	useLayoutEffect(() => {
		if (!open) return;
		updatePopoverPosition();
	}, [open, updatePopoverPosition]);

	useEffect(() => {
		if (!open) return;

		const closeOnOutsideClick = (event: MouseEvent) => {
			const target = event.target as Node;
			if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
			setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};

		document.addEventListener("mousedown", closeOnOutsideClick);
		document.addEventListener("keydown", closeOnEscape);
		window.addEventListener("resize", updatePopoverPosition);
		window.addEventListener("scroll", updatePopoverPosition, true);
		return () => {
			document.removeEventListener("mousedown", closeOnOutsideClick);
			document.removeEventListener("keydown", closeOnEscape);
			window.removeEventListener("resize", updatePopoverPosition);
			window.removeEventListener("scroll", updatePopoverPosition, true);
		};
	}, [open, updatePopoverPosition]);

	return (
		<div ref={rootRef} className="relative shrink-0">
			<button
				ref={buttonRef}
				type="button"
				aria-label={unreadCount > 0 ? `生成通知，${unreadCount} 条未读` : "生成通知"}
				aria-expanded={open}
				className={cn(
					"relative flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
					open && "bg-ide-list-active text-ide-list-active-foreground",
				)}
				onClick={() => setOpen((current) => !current)}
			>
				<Bell className="size-4" />
				{unreadCount > 0 ? (
					<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground shadow-sm">
						{unreadCount > 99 ? "99+" : unreadCount}
					</span>
				) : null}
			</button>

			{open && popoverStyle
				? createPortal(
						<div
							ref={popoverRef}
							role="dialog"
							aria-label="生成通知"
							className="fixed z-[1000] flex flex-col rounded-sm border border-border bg-popover text-popover-foreground shadow-xl"
							style={popoverStyle}
						>
							<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
								<div className="min-w-0">
									<p className="truncate text-xs font-semibold text-foreground">生成通知</p>
									<p className="mt-0.5 text-2xs text-muted-foreground">
										{notifications.length > 0 ? `${notifications.length} 条记录` : "暂无记录"}
									</p>
								</div>
								<button
									type="button"
									className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-ide-list-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
									disabled={unreadCount === 0}
									title="全部已读"
									aria-label="全部已读"
									onClick={markAllNotificationsRead}
								>
									<CheckCheck className="size-3.5" />
								</button>
							</div>

							<div className="min-h-0 overflow-y-auto p-1.5">
								{notifications.length === 0 ? (
									<p className="px-2 py-6 text-center text-xs text-muted-foreground">
										生成完成后会显示在这里。
									</p>
								) : (
									<div className="space-y-1">
										{notifications.map((notification) => (
											<GenerationNotificationItem
												key={notification.id}
												notification={notification}
												onClick={() => openNotificationAfterClose(notification)}
											/>
										))}
									</div>
								)}
							</div>
						</div>,
						document.body,
					)
				: null}
		</div>
	);
};

const GenerationNotificationItem: React.FC<{
	notification: GenerationSuccessNotification;
	onClick: () => void;
}> = ({ notification, onClick }) => {
	const Icon = generationNotificationKindIcons[notification.kind] ?? ImageIcon;

	return (
		<button
			type="button"
			className={cn(
				"grid w-full grid-cols-[1.75rem_minmax(0,1fr)] gap-2 rounded-sm border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-ide-list-hover",
				!notification.readAt && "bg-info-surface/70",
			)}
			aria-label={`打开 ${notification.description}`}
			onClick={onClick}
		>
			<span className="relative mt-0.5 flex size-6 items-center justify-center rounded-sm border border-border bg-ide-toolbar text-muted-foreground">
				<Icon className="size-3.5" />
				{notification.readAt ? null : (
					<span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary" />
				)}
			</span>
			<span className="min-w-0">
				<span className="flex min-w-0 items-center justify-between gap-2">
					<span className="truncate text-xs font-semibold text-foreground">
						{notification.title}
					</span>
					<time className="shrink-0 text-2xs text-muted-foreground">
						{generationNotificationTime(notification.createdAt)}
					</time>
				</span>
				<span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
					{notification.description}
				</span>
			</span>
		</button>
	);
};

const generationNotificationKindIcons: Record<GenerationNotificationOpenKind, LucideIcon> = {
	audio: AudioLines,
	image: ImageIcon,
	video: Film,
};

const samePopoverStyle = (current: React.CSSProperties | null, next: React.CSSProperties) => {
	if (!current) return false;

	return (
		current.bottom === next.bottom &&
		current.left === next.left &&
		current.maxHeight === next.maxHeight &&
		current.width === next.width
	);
};

const generationNotificationTime = (createdAt: string) => {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) return "";

	return date.toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
};
