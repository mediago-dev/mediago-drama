import { useEffect, useState } from "react";

export const dialogAnimationDurationMs = 240;

export const dialogOverlayMotion =
	"data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-200";

export const dialogContentMotion =
	"origin-center ![animation-duration:240ms] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-90 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-90";

export const useDialogPresence = (
	open: boolean,
	durationMs: number = dialogAnimationDurationMs,
) => {
	const [present, setPresent] = useState(open);

	useEffect(() => {
		if (open) {
			setPresent(true);
			return;
		}

		if (!present) return;

		const timeout = window.setTimeout(() => setPresent(false), durationMs);
		return () => window.clearTimeout(timeout);
	}, [durationMs, open, present]);

	return present;
};
