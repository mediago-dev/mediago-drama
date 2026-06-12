import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useThemeStore } from "@/shared/stores/theme";

export const Toaster = (props: ToasterProps) => {
	const mode = useThemeStore((state) => state.mode);

	return (
		<Sonner
			theme={mode}
			className="toaster group"
			closeButton
			richColors
			visibleToasts={5}
			{...props}
		/>
	);
};
