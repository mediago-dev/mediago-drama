import type React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";
import type { SidebarScreenId } from "./ProjectNavigatorTypes";

const sidebarTransitionDurationMs = 300;
type SidebarTransitionDirection = "push" | "pop";

interface SidebarTransition {
	activeId: SidebarScreenId;
	activeLevel: number;
	direction: SidebarTransitionDirection;
	previousId: SidebarScreenId;
	previousLevel: number;
}

interface SidebarScreenStackProps {
	activeId: SidebarScreenId;
	screens: readonly {
		id: SidebarScreenId;
		level: number;
		node: React.ReactNode;
	}[];
}

export const SidebarScreenStack: React.FC<SidebarScreenStackProps> = ({ activeId, screens }) => {
	const previousActiveIdRef = useRef<SidebarScreenId>(activeId);
	const previousActiveId = previousActiveIdRef.current;
	const activeScreen = screens.find((screen) => screen.id === activeId);
	const previousScreen = screens.find((screen) => screen.id === previousActiveId);
	const activeLevel = activeScreen?.level ?? 1;
	const previousLevel = previousScreen?.level ?? activeLevel;
	const transitionTimeoutRef = useRef<number | null>(null);
	const [heldTransition, setHeldTransition] = useState<SidebarTransition | null>(null);
	const isDepthChange = previousActiveId !== activeId && previousLevel !== activeLevel;
	const immediateTransition: SidebarTransition | null = isDepthChange
		? {
				activeId,
				activeLevel,
				direction: activeLevel > previousLevel ? "push" : "pop",
				previousId: previousActiveId,
				previousLevel,
			}
		: null;
	const activeTransition =
		immediateTransition ?? (heldTransition?.activeId === activeId ? heldTransition : null);
	const skipTransition = !activeTransition;

	useEffect(() => {
		if (previousActiveId === activeId) return;

		previousActiveIdRef.current = activeId;

		if (transitionTimeoutRef.current) window.clearTimeout(transitionTimeoutRef.current);
		if (!isDepthChange) {
			setHeldTransition(null);
			return;
		}

		setHeldTransition({
			activeId,
			activeLevel,
			direction: activeLevel > previousLevel ? "push" : "pop",
			previousId: previousActiveId,
			previousLevel,
		});
		transitionTimeoutRef.current = window.setTimeout(() => {
			setHeldTransition(null);
			transitionTimeoutRef.current = null;
		}, sidebarTransitionDurationMs);
	}, [activeId, activeLevel, isDepthChange, previousActiveId, previousLevel]);

	useEffect(
		() => () => {
			if (transitionTimeoutRef.current) window.clearTimeout(transitionTimeoutRef.current);
		},
		[],
	);

	return (
		<>
			{screens.map((screen) => {
				const isActive = screen.id === activeId;

				return (
					<section
						key={screen.id}
						className={cn(
							"absolute inset-0 flex h-full w-full min-w-full flex-col bg-ide-sidebar px-2 py-3 will-change-transform",
							skipTransition ? "transition-none" : "transition-transform duration-300 ease-in-out",
							screenTransformClass(screen, activeId, activeLevel, activeTransition),
						)}
						aria-hidden={!isActive}
						inert={!isActive}
					>
						{screen.node}
					</section>
				);
			})}
		</>
	);
};

export const screenTransformClass = (
	screen: { id: SidebarScreenId; level: number },
	activeId: SidebarScreenId,
	activeLevel: number,
	transition: SidebarTransition | null,
) => {
	if (transition) return transitionScreenTransformClass(screen, activeId, activeLevel, transition);

	if (screen.id === activeId) return "z-20 translate-x-0 opacity-100";
	if (screen.level < activeLevel) return "z-0 translate-x-0 opacity-100";
	if (screen.level > activeLevel) return "z-0 translate-x-full opacity-100";
	return "z-0 translate-x-0 opacity-0";
};

const transitionScreenTransformClass = (
	screen: { id: SidebarScreenId; level: number },
	activeId: SidebarScreenId,
	activeLevel: number,
	transition: SidebarTransition,
) => {
	if (transition.direction === "push") {
		if (screen.id === activeId) return "z-20 translate-x-0 opacity-100";
		if (screen.id === transition.previousId) return "z-10 translate-x-0 opacity-100";
		if (screen.level > activeLevel) return "z-0 translate-x-full opacity-100";
		return "z-0 translate-x-0 opacity-0";
	}

	if (screen.id === activeId) return "z-10 translate-x-0 opacity-100";
	if (screen.id === transition.previousId) return "z-20 translate-x-full opacity-100";
	if (screen.level < activeLevel) return "z-0 translate-x-0 opacity-100";
	if (screen.level > activeLevel) return "z-0 translate-x-full opacity-100";
	return "z-0 translate-x-0 opacity-0";
};
