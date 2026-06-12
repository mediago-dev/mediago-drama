import {
	AudioLines,
	BookOpen,
	Box,
	Clapperboard,
	FileText,
	Film,
	Image,
	ScanSearch,
	ScanText,
	Scissors,
	Sparkles,
	type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
	AudioLines,
	BookOpen,
	Clapperboard,
	FileText,
	Film,
	Image,
	ScanSearch,
	ScanText,
	Scissors,
	Sparkles,
};

export const iconByName = (name: string): LucideIcon => icons[name] ?? Box;
