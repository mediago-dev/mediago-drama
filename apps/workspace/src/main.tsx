import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SWRProvider } from "./providers/SWRProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { DialogCallHost } from "@/shared/components/callable/DialogCallHost";
import "@/styles/index.css";

const isTauriRuntime = "__TAURI_INTERNALS__" in window;
const platformSignal = `${window.navigator.platform} ${window.navigator.userAgent}`;
const isMacLikePlatform = /\b(Mac|iPhone|iPad|iPod)\b/i.test(platformSignal);

document.documentElement.classList.toggle("is-tauri", isTauriRuntime);
document.documentElement.classList.toggle("is-tauri-macos", isTauriRuntime && isMacLikePlatform);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<ThemeProvider>
			<SWRProvider>
				<BrowserRouter>
					<ErrorBoundary>
						<App />
						<DialogCallHost />
					</ErrorBoundary>
				</BrowserRouter>
			</SWRProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
