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
					</ErrorBoundary>
				</AppRouter>
			</SWRProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
