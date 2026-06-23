/// <reference types="vite/client" />

import type { MediagoDesktopAPI } from "@/shared/desktop/types";

declare global {
	interface Window {
		mediagoDesktop?: MediagoDesktopAPI;
	}
}
