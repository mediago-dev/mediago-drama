import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SWRProvider } from "@/providers/SWRProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import "@/styles/index.css";

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(
	<React.StrictMode>
		<ThemeProvider>
			<SWRProvider>
				<ErrorBoundary>
					<App />
				</ErrorBoundary>
			</SWRProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
