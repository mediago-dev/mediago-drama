import * as React from "react";
// `toast` is re-exported from sonner on the bundle so it shares the bundled
// Toaster's sonner instance (see .design-sync-entry.ts).
import { Toaster, toast } from "react-spa-template";

export function Notifications() {
	React.useEffect(() => {
		toast.success("Draft saved", {
			description: "Your script outline was saved automatically.",
			duration: Number.POSITIVE_INFINITY,
		});
		toast.error("Export failed", {
			description: "The render service timed out on episode 3.",
			duration: Number.POSITIVE_INFINITY,
		});
	}, []);
	return (
		<div style={{ position: "relative", minHeight: 220 }}>
			<Toaster position="bottom-right" />
		</div>
	);
}
