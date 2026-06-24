import { Box } from "lucide-react";
import type React from "react";
import dmxIcon from "@/domains/generation/assets/dmxapi-logo.png";
import type {
	GenerationFamily,
	GenerationRoute,
	GenerationVersion,
} from "@/domains/generation/api/generation";
import deepSeekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import doubaoIcon from "@lobehub/icons-static-svg/icons/doubao-color.svg";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import jimengIcon from "@lobehub/icons-static-svg/icons/jimeng-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import openAIIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import openRouterIcon from "@lobehub/icons-static-svg/icons/openrouter.svg";
import volcengineIcon from "@lobehub/icons-static-svg/icons/volcengine-color.svg";
import { cn } from "@/shared/lib/utils";

export type GenerationBrandKey =
	| "deepseek"
	| "dmx"
	| "doubao"
	| "gemini"
	| "gpt"
	| "jimeng"
	| "minimax"
	| "model"
	| "openai"
	| "openrouter"
	| "volcengine";

interface BrandSpec {
	icon?: string;
	label: string;
}

const brandSpecs: Record<GenerationBrandKey, BrandSpec> = {
	deepseek: { icon: deepSeekIcon, label: "DeepSeek" },
	dmx: { icon: dmxIcon, label: "DMXAPI" },
	doubao: { icon: doubaoIcon, label: "豆包" },
	gemini: { icon: geminiIcon, label: "Gemini" },
	gpt: { icon: openAIIcon, label: "GPT / OpenAI" },
	jimeng: { icon: jimengIcon, label: "即梦" },
	minimax: { icon: minimaxIcon, label: "MiniMax 国内" },
	model: { label: "模型" },
	openai: { icon: openAIIcon, label: "OpenAI" },
	openrouter: {
		icon: openRouterIcon,
		label: "OpenRouter",
	},
	volcengine: { icon: volcengineIcon, label: "火山引擎" },
};

export const GenerationBrandMark: React.FC<{
	brand?: GenerationBrandKey;
	className?: string;
}> = ({ brand = "model", className }) => {
	const spec = brandSpecs[brand] ?? brandSpecs.model;

	return (
		<i
			aria-hidden="true"
			data-generation-brand={brand}
			title={spec.label}
			className={cn(
				"inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-background/80 p-0.5 text-foreground not-italic shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.25)]",
				className,
			)}
		>
			{spec.icon ? (
				<img src={spec.icon} alt="" draggable={false} className="size-full object-contain" />
			) : (
				<Box className="size-full opacity-70" />
			)}
		</i>
	);
};

export const GenerationBrandStack: React.FC<{
	className?: string;
	modelBrand?: GenerationBrandKey;
	providerBrand?: GenerationBrandKey;
}> = ({ className, modelBrand = "model", providerBrand }) => {
	const brands =
		providerBrand && providerBrand !== modelBrand ? [modelBrand, providerBrand] : [modelBrand];

	return (
		<span
			className={cn("flex shrink-0 items-center", brands.length > 1 ? "-space-x-1" : "", className)}
		>
			{brands.map((brand, index) => (
				<GenerationBrandMark
					key={`${brand}:${index}`}
					brand={brand}
					className={brands.length > 1 ? "ring-1 ring-background" : undefined}
				/>
			))}
		</span>
	);
};

export const generationProviderBrand = (provider: string): GenerationBrandKey => {
	switch (provider.trim().toLowerCase()) {
		case "openai":
			return "openai";
		case "google":
			return "gemini";
		case "volcengine":
			return "volcengine";
		case "dmx":
			return "dmx";
		case "openrouter":
			return "openrouter";
		case "jimeng":
			return "jimeng";
		case "minimax":
			return "minimax";
		case "deepseek":
			return "deepseek";
		default:
			return generationBrandFromTokens([provider]);
	}
};

export const generationModelBrand = (input: {
	family?: Partial<GenerationFamily>;
	route?: Partial<GenerationRoute>;
	version?: Partial<GenerationVersion>;
}): GenerationBrandKey =>
	generationBrandFromTokens([
		input.route?.model,
		input.route?.label,
		input.version?.canonicalModel,
		input.version?.label,
		input.version?.id,
		input.family?.label,
		input.family?.id,
	]);

export const generationFamilyBrand = (family: Partial<GenerationFamily>): GenerationBrandKey =>
	generationBrandFromTokens([family.label, family.id]);

export const generationVersionBrand = (
	version: Partial<GenerationVersion>,
	route?: Partial<GenerationRoute>,
): GenerationBrandKey =>
	generationBrandFromTokens([route?.model, version.canonicalModel, version.label, version.id]);

const generationBrandFromTokens = (tokens: Array<string | undefined>): GenerationBrandKey => {
	const normalized = tokens
		.filter((token): token is string => Boolean(token?.trim()))
		.map((token) => token.trim().toLowerCase())
		.join(" ");

	if (!normalized) return "model";
	if (/\bgpt\b|chatgpt|openai\/gpt|gpt-/.test(normalized)) return "gpt";
	if (normalized.includes("gemini") || normalized.includes("nano-banana")) return "gemini";
	if (
		normalized.includes("seedance") ||
		normalized.includes("seedream") ||
		normalized.includes("doubao")
	) {
		return "doubao";
	}
	if (normalized.includes("jimeng") || normalized.includes("即梦")) return "jimeng";
	if (normalized.includes("minimax") || normalized.includes("speech-2.8")) return "minimax";
	if (normalized.includes("deepseek")) return "deepseek";
	if (normalized === "text" || normalized.includes("gpt text")) return "gpt";
	if (normalized.includes("volc") || normalized.includes("火山")) return "volcengine";
	if (normalized.includes("dmx")) return "dmx";
	if (normalized.includes("openrouter")) return "openrouter";
	if (normalized.includes("openai")) return "openai";

	return "model";
};
