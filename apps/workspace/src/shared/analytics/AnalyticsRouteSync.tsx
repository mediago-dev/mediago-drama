import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { desktopRuntime } from "@/shared/desktop/runtime";
import { AnalyticsEvent } from "./events";
import { analytics } from "./talking-data";

let didTrackPageLoad = false;
let lastTrackedPage = "";

export const AnalyticsRouteSync = () => {
	const location = useLocation();

	useEffect(() => {
		if (didTrackPageLoad) return;
		didTrackPageLoad = true;
		analytics.track(AnalyticsEvent.PageLoad, {
			environment: import.meta.env.VITE_ENVIRONMENT,
			runtime: desktopRuntime(),
			version: import.meta.env.VITE_APP_VERSION,
		});
	}, []);

	useEffect(() => {
		const page = `${location.pathname}${location.search}${location.hash}`;
		if (page === lastTrackedPage) return;
		lastTrackedPage = page;
		analytics.track(AnalyticsEvent.ChangePage, {
			page,
			pathname: location.pathname,
			runtime: desktopRuntime(),
		});
	}, [location.hash, location.pathname, location.search]);

	return null;
};
