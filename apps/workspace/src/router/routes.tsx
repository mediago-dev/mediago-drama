import type React from "react";
import { lazy, Suspense } from "react";
import { type RouteObject, useRoutes } from "react-router-dom";
import { WorkspaceContentFallback } from "@/domains/workspace/components/WorkspaceContentFallback";
import { Home } from "@/pages/Home";
import { useWorkModeStore } from "@/lib/stores/work-mode";

const Projects = lazy(() =>
	import("@/pages/Projects").then((module) => ({ default: module.Projects })),
);
const Settings = lazy(() =>
	import("@/pages/Settings").then((module) => ({ default: module.Settings })),
);
const StudioHome = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioHome })),
);
const StudioImage = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioImage })),
);
const StudioVideo = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioVideo })),
);
const StudioText = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioText })),
);
const StudioAudio = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioAudio })),
);
const StudioNovelUnderstand = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioNovelUnderstand })),
);
const StudioVideoUnderstand = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioVideoUnderstand })),
);
const StudioAudioTranscribe = lazy(() =>
	import("@/pages/Studio").then((module) => ({ default: module.StudioAudioTranscribe })),
);

function RootShell() {
	const mode = useWorkModeStore((state) => state.mode);

	if (mode === "studio") return <StudioHome />;
	return <Projects />;
}

const routes: RouteObject[] = [
	{ path: "/", element: <RootShell /> },
	{ path: "/agent", element: <Home /> },
	{ path: "/studio/image", element: <StudioImage /> },
	{ path: "/studio/video", element: <StudioVideo /> },
	{ path: "/studio/text", element: <StudioText /> },
	{ path: "/studio/audio", element: <StudioAudio /> },
	{ path: "/studio/novel-understand", element: <StudioNovelUnderstand /> },
	{ path: "/studio/video-understand", element: <StudioVideoUnderstand /> },
	{ path: "/studio/audio-transcribe", element: <StudioAudioTranscribe /> },
	{ path: "/settings", element: <Settings /> },
	{ path: "*", element: <div>404 - 页面未找到</div> },
];

export const AppRoutes: React.FC = () => {
	const element = useRoutes(routes);
	return <Suspense fallback={<WorkspaceContentFallback />}>{element}</Suspense>;
};
