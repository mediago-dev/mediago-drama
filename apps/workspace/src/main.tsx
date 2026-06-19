import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SWRProvider } from "./providers/SWRProvider";
import { ThemeProvider } from "./providers/ThemeProvider";
import { DialogCallHost } from "@/shared/components/callable/DialogCallHost";
import "@/styles/index.css";

document.documentElement.classList.toggle("is-tauri", "__TAURI_INTERNALS__" in window);

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
