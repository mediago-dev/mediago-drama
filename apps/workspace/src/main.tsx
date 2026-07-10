import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SWRProvider } from "./providers/SWRProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { LicenseGate } from "@/domains/settings/components/license/LicenseGate";
import { DialogCallHost } from "@/shared/components/callable/DialogCallHost";
import { analytics } from "@/shared/analytics";
import { markRendererHealthy } from "@/shared/desktop/actions";
import { desktopRuntime } from "@/shared/desktop/runtime";
import "@/styles/index.css";

const runtime = desktopRuntime();
const isDesktop = runtime !== "browser";
const AppRouter = window.location.protocol === "file:" ? HashRouter : BrowserRouter;
const platformSignal = `${window.navigator.platform} ${window.navigator.userAgent}`;
const isMacLikePlatform =
	window.mediagoDesktop?.platform === "darwin" ||
	/\b(Mac|iPhone|iPad|iPod)\b/i.test(platformSignal);

document.documentElement.classList.toggle("is-desktop", isDesktop);
document.documentElement.classList.toggle("is-electron", runtime === "electron");
document.documentElement.classList.toggle("is-desktop-macos", isDesktop && isMacLikePlatform);

analytics.init();

// Confirms to the shell that this renderer bundle booted successfully, so a hot-updated
// bundle is not rolled back by the health check (see electron/src/renderer-store.ts).
// Lives inside the ErrorBoundary: if the tree crashes on mount, the beacon never fires
// and the shell falls back to the builtin renderer on a later launch.
const RendererHealthBeacon: React.FC = () => {
	React.useEffect(() => {
		if (runtime !== "electron") return;
		void markRendererHealthy();
	}, []);
	return null;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<ThemeProvider>
			<SWRProvider>
				<AppRouter>
					<ErrorBoundary>
						<LicenseGate>
							<App />
						</LicenseGate>
						<DialogCallHost />
						<RendererHealthBeacon />
					</ErrorBoundary>
				</AppRouter>
			</SWRProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
