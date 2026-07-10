export type AppEdition = "community" | "pro";

// Build-time edition flag, injected via VITE_MEDIAGO_EDITION at dev/build
// time (see Taskfile.yml EDITION). Pro builds expose commercial UI such as
// the license activation panel; community builds omit it entirely.
export const appEdition: AppEdition =
	import.meta.env.VITE_MEDIAGO_EDITION === "pro" ? "pro" : "community";

// isProEdition reports whether this build includes commercial (Pro) UI.
export const isProEdition = (): boolean => appEdition === "pro";
