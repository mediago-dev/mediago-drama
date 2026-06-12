import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export const useAutoResizeTextarea = (value: string) => {
	const ref = useRef<HTMLTextAreaElement>(null);
	const resize = useCallback(() => {
		const textarea = ref.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${textarea.scrollHeight}px`;
	}, []);

	useLayoutEffect(() => {
		resize();
	}, [resize, value]);

	useEffect(() => {
		window.addEventListener("resize", resize);
		const textarea = ref.current;
		if (!textarea || typeof ResizeObserver === "undefined") {
			return () => window.removeEventListener("resize", resize);
		}

		let previousWidth = textarea.clientWidth;
		const observer = new ResizeObserver((entries) => {
			const nextWidth = entries[0]?.contentRect.width ?? textarea.clientWidth;
			if (nextWidth === previousWidth) return;
			previousWidth = nextWidth;
			resize();
		});
		observer.observe(textarea);

		return () => {
			window.removeEventListener("resize", resize);
			observer.disconnect();
		};
	}, [resize]);

	return ref;
};
