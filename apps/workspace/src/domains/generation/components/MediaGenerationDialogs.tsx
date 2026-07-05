import {
	Check,
	ChevronDown,
	Images,
	Loader2,
	Pause,
	Play,
	SlidersHorizontal,
	Star,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { GenerationParam } from "@/domains/generation/api/generation";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/components/ui/select";
import {
	paramHelp,
	paramLabel,
	paramOptionLabel,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export { MaterialLibraryImportDialog } from "./MaterialLibraryImportDialog";

export const GenerationCountControl: React.FC<{
	max: number;
	min: number;
	onChange: (value: number) => void;
	value: number;
}> = ({ max, min, onChange, value }) => {
	const [open, setOpen] = useState(false);
	const options = useMemo(
		() => Array.from({ length: max - min + 1 }, (_, index) => min + index),
		[max, min],
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`生成数量：${value}`}
					className={cn(
						"flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						"h-[var(--generation-control-height)] rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground hover:bg-ide-list-hover",
						open && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<Images className="size-4 shrink-0 text-muted-foreground" />
					<span>数量 {value}</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label="生成数量"
				className="w-[min(var(--generation-count-popover-width),var(--generation-popover-max-inline))] rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-2xl"
			>
				<div className="mb-2 px-2">
					<p className="text-xs font-semibold text-muted-foreground">数量</p>
				</div>
				<div className="grid gap-2">
					{options.map((option) => {
						const selected = option === value;

						return (
							<button
								key={option}
								type="button"
								className={cn(
									"transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									"flex h-[var(--generation-count-option-height)] items-center justify-between rounded-[var(--generation-control-radius)] px-[var(--generation-control-padding-x)] text-xs font-semibold",
									selected
										? "bg-ide-list-active text-ide-list-active-foreground"
										: "text-foreground hover:bg-muted",
								)}
								onClick={() => {
									onChange(option);
									setOpen(false);
								}}
							>
								<span>{option}</span>
								{selected ? <Check className="size-5 text-primary" /> : null}
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
};

export const PrimaryParamControl: React.FC<{
	label?: string;
	onChange: (value: string) => void;
	onPreviewVoice?: (voiceID: string) => void | Promise<void>;
	param: GenerationParam;
	playingVoiceId?: string | null;
	previewableVoiceIds?: ReadonlySet<string>;
	previewingVoiceId?: string | null;
	value: unknown;
}> = ({
	label: triggerLabel,
	onChange,
	onPreviewVoice,
	param,
	playingVoiceId,
	previewableVoiceIds,
	previewingVoiceId,
	value,
}) => {
	const [open, setOpen] = useState(false);
	const options = param.options ?? [];
	const selectedValue = String(value ?? param.default ?? options[0]?.value ?? "");
	const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];
	const label = paramLabel(param.label);
	const controlLabel = triggerLabel ?? label;
	const selectedLabel = selectedOption ? paramOptionLabel(selectedOption.label) : "未选择";
	const denseOptions = options.length > 24;

	if (options.length === 0) return null;
	if (param.name === "voiceId") {
		return (
			<VoiceParamControl
				controlLabel={controlLabel}
				open={open}
				options={options}
				param={param}
				playingVoiceId={playingVoiceId}
				previewableVoiceIds={previewableVoiceIds}
				selectedLabel={selectedLabel}
				selectedValue={selectedValue}
				previewingVoiceId={previewingVoiceId}
				onChange={onChange}
				onOpenChange={setOpen}
				onPreviewVoice={onPreviewVoice}
			/>
		);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${controlLabel}：${selectedLabel}`}
					className={cn(
						"flex min-w-0 items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						"h-[var(--generation-control-height)] max-w-48 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover",
						open && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<span className="truncate">
						{controlLabel}: {selectedLabel}
					</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label={label}
				className={cn(
					"w-[min(var(--generation-primary-popover-width),var(--generation-popover-max-inline))] rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding-lg)] text-popover-foreground shadow-xl",
					denseOptions &&
						"max-h-[var(--generation-popover-max-block)] w-[min(var(--generation-other-popover-width),var(--generation-popover-max-inline))] overflow-y-auto",
				)}
			>
				<div className="mb-3">
					<p className="text-sm font-semibold">{label}</p>
					{param.help ? (
						<p className="mt-0.5 text-xs text-muted-foreground">{paramHelp(param.help)}</p>
					) : null}
				</div>
				<div className={cn("grid gap-1.5", denseOptions ? "grid-cols-1" : "grid-cols-2")}>
					{options.map((option) => {
						const optionLabel = paramOptionLabel(option.label);
						const selected = option.value === selectedValue;

						return (
							<button
								key={option.value}
								type="button"
								className={cn(
									"flex h-[var(--generation-primary-option-height)] min-w-0 items-center rounded-[var(--generation-control-radius)] border px-[var(--generation-control-padding-x)] text-xs font-medium transition-colors",
									denseOptions ? "justify-start" : "justify-center",
									selected
										? "border-primary bg-primary text-primary-foreground"
										: "border-border bg-card text-muted-foreground hover:bg-ide-list-hover hover:text-foreground",
								)}
								onClick={() => {
									onChange(option.value);
									setOpen(false);
								}}
							>
								<span className="truncate">{optionLabel}</span>
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
};

type VoiceTab = "all" | "favorites";
type VoiceGender = "all" | "female" | "male" | "child" | "character";
type VoiceAge = "all" | "child" | "youth" | "adult" | "elder" | "character";
type VoiceTrait =
	| "all"
	| "gentle"
	| "sweet"
	| "mature"
	| "news"
	| "story"
	| "confident"
	| "playful"
	| "character";

interface VoiceChoice {
	age: VoiceAge;
	gender: VoiceGender;
	language: string;
	label: string;
	name: string;
	trait: VoiceTrait;
	traitLabel: string;
	value: string;
}

const allVoiceFilterValue = "all";
const voiceFavoriteStorageKey = "generation.minimax.voiceFavorites";

const VoiceParamControl: React.FC<{
	controlLabel: string;
	onChange: (value: string) => void;
	onOpenChange: (open: boolean) => void;
	onPreviewVoice?: (voiceID: string) => void | Promise<void>;
	open: boolean;
	options: NonNullable<GenerationParam["options"]>;
	param: GenerationParam;
	playingVoiceId?: string | null;
	previewableVoiceIds?: ReadonlySet<string>;
	previewingVoiceId?: string | null;
	selectedLabel: string;
	selectedValue: string;
}> = ({
	controlLabel,
	onChange,
	onOpenChange,
	onPreviewVoice,
	open,
	options,
	param,
	playingVoiceId,
	previewableVoiceIds,
	previewingVoiceId,
	selectedLabel,
	selectedValue,
}) => {
	const [activeTab, setActiveTab] = useState<VoiceTab>("all");
	const [gender, setGender] = useState<VoiceGender>("all");
	const [age, setAge] = useState<VoiceAge>("all");
	const [language, setLanguage] = useState(allVoiceFilterValue);
	const [trait, setTrait] = useState<VoiceTrait>("all");
	const [favorites, setFavorites] = useState<Set<string>>(() => readVoiceFavorites());
	const voices = useMemo(() => options.map(toVoiceChoice), [options]);
	const selectedVoice = voices.find((voice) => voice.value === selectedValue) ?? voices[0];
	const languages = useMemo(
		() => Array.from(new Set(voices.map((voice) => voice.language))).filter(Boolean),
		[voices],
	);
	const visibleVoices = useMemo(
		() =>
			voices.filter((voice) => {
				if (activeTab === "favorites" && !favorites.has(voice.value)) return false;
				if (gender !== "all" && voice.gender !== gender) return false;
				if (age !== "all" && voice.age !== age) return false;
				if (language !== allVoiceFilterValue && voice.language !== language) return false;
				if (trait !== "all" && voice.trait !== trait) return false;
				return true;
			}),
		[activeTab, age, favorites, gender, language, trait, voices],
	);
	const triggerLabel = selectedVoice?.label ?? selectedLabel;

	const toggleFavorite = (voiceID: string) => {
		const next = new Set(favorites);
		if (next.has(voiceID)) {
			next.delete(voiceID);
		} else {
			next.add(voiceID);
		}
		setFavorites(next);
		writeVoiceFavorites(next);
	};

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`${controlLabel}：${triggerLabel}`}
					className={cn(
						"flex min-w-0 items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						"h-[var(--generation-control-height)] max-w-56 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover",
						open && "bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<span className="truncate">
						{controlLabel}: {triggerLabel}
					</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label={paramLabel(param.label)}
				className="w-[min(42rem,var(--generation-popover-max-inline))] overflow-hidden rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-2xl"
				style={{
					height:
						"min(24rem, var(--generation-popover-max-block, 24rem), calc(var(--radix-popover-content-available-height, 24rem) - 0.5rem))",
					maxHeight: "calc(var(--radix-popover-content-available-height, 24rem) - 0.5rem)",
				}}
			>
				<div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
					<nav className="flex min-w-0 flex-wrap items-center gap-5" aria-label="音色来源">
						{voiceTabs.map((tab) => (
							<button
								key={tab.value}
								type="button"
								className={cn(
									"text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									activeTab === tab.value
										? "text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
								onClick={() => setActiveTab(tab.value)}
							>
								{tab.label}
							</button>
						))}
					</nav>

					<div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
						<VoiceFilterSelect
							ariaLabel="性别"
							value={gender}
							options={voiceGenderOptions}
							onChange={(value) => setGender(value as VoiceGender)}
						/>
						<VoiceFilterSelect
							ariaLabel="年龄"
							value={age}
							options={voiceAgeOptions}
							onChange={(value) => setAge(value as VoiceAge)}
						/>
						<VoiceFilterSelect
							ariaLabel="语言"
							value={language}
							options={[
								{ label: "全部", value: allVoiceFilterValue },
								...languages.map((item) => ({ label: item, value: item })),
							]}
							onChange={setLanguage}
						/>
						<VoiceFilterSelect
							ariaLabel="声音特点"
							value={trait}
							options={voiceTraitOptions}
							onChange={(value) => setTrait(value as VoiceTrait)}
						/>
					</div>

					<div
						className="min-h-0 overflow-y-auto overscroll-contain pr-1"
						tabIndex={0}
						style={{
							maxHeight:
								"calc(min(24rem, var(--generation-popover-max-block, 24rem), calc(var(--radix-popover-content-available-height, 24rem) - 0.5rem)) - 5.5rem)",
						}}
						onWheel={(event) => event.stopPropagation()}
					>
						{visibleVoices.length === 0 ? (
							<VoiceEmptyState
								label={activeTab === "favorites" ? "暂无收藏音色" : "没有匹配音色"}
							/>
						) : (
							<div className="grid grid-cols-1 gap-x-2.5 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
								{visibleVoices.map((voice) => (
									<VoiceOptionButton
										key={voice.value}
										favorited={favorites.has(voice.value)}
										playing={playingVoiceId === voice.value}
										previewing={previewingVoiceId === voice.value}
										selected={voice.value === selectedValue}
										voice={voice}
										onFavoriteToggle={() => toggleFavorite(voice.value)}
										onPreview={
											onPreviewVoice && previewableVoiceIds?.has(voice.value)
												? () => void onPreviewVoice(voice.value)
												: undefined
										}
										onSelect={() => {
											onChange(voice.value);
											onOpenChange(false);
										}}
									/>
								))}
							</div>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
};

const VoiceFilterSelect: React.FC<{
	ariaLabel: string;
	onChange: (value: string) => void;
	options: Array<{ label: string; value: string }>;
	value: string;
}> = ({ ariaLabel, onChange, options, value }) => {
	const selectedOption = options.find((option) => option.value === value);
	const triggerLabel =
		value === allVoiceFilterValue ? ariaLabel : (selectedOption?.label ?? ariaLabel);

	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger
				aria-label={ariaLabel}
				className="h-[var(--generation-control-height)] rounded-[var(--generation-control-radius)] border-input bg-muted px-2 text-xs font-semibold shadow-none hover:bg-ide-list-hover"
			>
				<span className="min-w-0 truncate">{triggerLabel}</span>
			</SelectTrigger>
			<SelectContent className="max-h-64">
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
};

const VoiceOptionButton: React.FC<{
	favorited: boolean;
	onFavoriteToggle: () => void;
	onPreview?: () => void;
	onSelect: () => void;
	playing: boolean;
	previewing: boolean;
	selected: boolean;
	voice: VoiceChoice;
}> = ({
	favorited,
	onFavoriteToggle,
	onPreview,
	onSelect,
	playing,
	previewing,
	selected,
	voice,
}) => (
	<div
		className={cn(
			"group flex min-w-0 items-center gap-2 rounded-[var(--generation-control-radius)] px-1 py-0.5 transition-colors",
			selected ? "bg-ide-list-active" : "hover:bg-muted/70",
		)}
	>
		{onPreview ? (
			<button
				type="button"
				aria-label={playing ? `暂停 ${voice.label}` : `预览 ${voice.label}`}
				className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-ide-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
				disabled={previewing}
				onClick={onPreview}
			>
				{previewing ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : playing ? (
					<Pause className="size-3.5 fill-current" />
				) : (
					<Play className="ml-0.5 size-3.5 fill-current" />
				)}
			</button>
		) : null}
		<button
			type="button"
			aria-label={`选择 ${voice.label}`}
			className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={onSelect}
		>
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-xs font-semibold text-foreground">{voice.name}</span>
					<span className="shrink-0 rounded bg-info-surface px-1.5 py-0.5 text-2xs font-semibold text-info-foreground">
						{voice.traitLabel}
					</span>
				</span>
				<span className="mt-0.5 block truncate text-2xs text-muted-foreground">
					{voice.language}
				</span>
			</span>
			{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
		</button>
		<button
			type="button"
			aria-label={favorited ? `取消收藏 ${voice.name}` : `收藏 ${voice.name}`}
			aria-pressed={favorited}
			className={cn(
				"inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
				favorited && "text-warning-foreground opacity-100",
			)}
			onClick={onFavoriteToggle}
		>
			<Star className={cn("size-3.5", favorited && "fill-current")} />
		</button>
	</div>
);

const VoiceEmptyState: React.FC<{ label: string }> = ({ label }) => (
	<div className="flex h-full min-h-28 items-center justify-center rounded-[var(--generation-control-radius)] border border-dashed border-border text-xs font-medium text-muted-foreground">
		{label}
	</div>
);

const voiceTabs: Array<{ label: string; value: VoiceTab }> = [
	{ label: "全部音色", value: "all" },
	{ label: "收藏", value: "favorites" },
];

const voiceGenderOptions: Array<{ label: string; value: VoiceGender }> = [
	{ label: "全部", value: "all" },
	{ label: "女声", value: "female" },
	{ label: "男声", value: "male" },
	{ label: "童声", value: "child" },
	{ label: "角色", value: "character" },
];

const voiceAgeOptions: Array<{ label: string; value: VoiceAge }> = [
	{ label: "全部", value: "all" },
	{ label: "儿童", value: "child" },
	{ label: "青年", value: "youth" },
	{ label: "成年", value: "adult" },
	{ label: "长者", value: "elder" },
	{ label: "角色", value: "character" },
];

const voiceTraitOptions: Array<{ label: string; value: VoiceTrait }> = [
	{ label: "全部", value: "all" },
	{ label: "温柔", value: "gentle" },
	{ label: "甜美", value: "sweet" },
	{ label: "成熟", value: "mature" },
	{ label: "播报", value: "news" },
	{ label: "叙事", value: "story" },
	{ label: "自信", value: "confident" },
	{ label: "活泼", value: "playful" },
	{ label: "角色", value: "character" },
];

const toVoiceChoice = (option: NonNullable<GenerationParam["options"]>[number]): VoiceChoice => {
	const label = paramOptionLabel(option.label);
	const [languagePart, ...nameParts] = label.split(" · ");
	const language = nameParts.length > 0 ? languagePart.trim() : "其他";
	const name = (nameParts.join(" · ") || label).trim();
	const searchText = `${label} ${option.value}`.toLowerCase();
	const gender = inferVoiceGender(searchText);
	const age = inferVoiceAge(searchText);
	const trait = inferVoiceTrait(searchText);

	return {
		age,
		gender,
		language,
		label,
		name,
		trait,
		traitLabel: voiceTraitOptions.find((item) => item.value === trait)?.label ?? "声音特点",
		value: option.value,
	};
};

const inferVoiceGender = (text: string): VoiceGender => {
	if (/(童|child|children|kid|elf)/i.test(text)) return "child";
	if (/(girl|woman|female|lady|sister|princess|queen|女|姐|妹|小姐|奶奶|阿姨|闺蜜)/i.test(text)) {
		return "female";
	}
	if (/(boy|man|male|gentleman|brother|king|男|哥|弟|爷|叔|少爷|男友|学长)/i.test(text)) {
		return "male";
	}
	return "character";
};

const inferVoiceAge = (text: string): VoiceAge => {
	if (/(童|child|children|kid|little|elf)/i.test(text)) return "child";
	if (/(elder|senior|大爷|奶奶|长者|花甲)/i.test(text)) return "elder";
	if (/(youth|teen|young|student|青年|少女|少年|学生|学弟|学姐|小哥|小玲|萌妹)/i.test(text)) {
		return "youth";
	}
	if (
		/(robot|ghost|armor|cartoon|anime|santa|rudolph|grinch|spirit|character|机械|卡通|动漫)/i.test(
			text,
		)
	) {
		return "character";
	}
	return "adult";
};

const inferVoiceTrait = (text: string): VoiceTrait => {
	if (/(gentle|warm|soft|kind|calm|serene|soothing|温柔|温暖|柔和|善良|热心)/i.test(text)) {
		return "gentle";
	}
	if (/(sweet|cute|lovely|charming|甜|可爱|萌|俏皮|清脆)/i.test(text)) return "sweet";
	if (/(mature|reliable|executive|senior|wise|成熟|沉稳|阅历|稳重)/i.test(text)) return "mature";
	if (/(news|anchor|announcer|host|radio|narrator|播报|新闻|主持|主播|旁白)/i.test(text)) {
		return "news";
	}
	if (/(story|storyteller|narrator|lyrical|dramatist|叙事|故事|抒情)/i.test(text)) {
		return "story";
	}
	if (
		/(confident|boss|dominant|strict|powerful|brave|determined|霸道|强势|自信|勇敢|嚣张)/i.test(
			text,
		)
	) {
		return "confident";
	}
	if (/(playful|cheerful|humorous|funny|jovial|energetic|活泼|搞笑|爽快|开心)/i.test(text)) {
		return "playful";
	}
	return "character";
};

const readVoiceFavorites = () => {
	if (typeof window === "undefined") return new Set<string>();
	try {
		const rawValue = window.localStorage.getItem(voiceFavoriteStorageKey);
		const parsed = rawValue ? JSON.parse(rawValue) : [];
		return new Set(
			Array.isArray(parsed)
				? parsed.filter((item): item is string => typeof item === "string")
				: [],
		);
	} catch {
		return new Set<string>();
	}
};

const writeVoiceFavorites = (favorites: Set<string>) => {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(voiceFavoriteStorageKey, JSON.stringify(Array.from(favorites)));
	} catch {
		// Ignore storage failures; voice selection itself should stay usable.
	}
};

export const SecondaryParamsDropdown: React.FC<{
	label?: string;
	onChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	values: Record<string, unknown>;
}> = ({ label = "其他", onChange, params, values }) => {
	const [open, setOpen] = useState(false);
	const triggerLabel = label === "Other" ? "其他" : paramLabel(label);

	if (params.length === 0) return null;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={triggerLabel}
					className={cn(
						"inline-flex min-w-0 items-center gap-1.5 border font-medium transition-colors",
						"h-[var(--generation-control-height)] max-w-48 rounded-[var(--generation-control-radius)] border-0 bg-muted px-[var(--generation-control-padding-x)] text-2xs font-semibold text-foreground shadow-none hover:bg-ide-list-hover",
						open && "border-primary bg-ide-list-active text-ide-list-active-foreground",
					)}
				>
					<SlidersHorizontal className="size-4 shrink-0" />
					<span>{triggerLabel}</span>
					<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="end"
				aria-label={`${triggerLabel}参数`}
				className="max-h-[var(--generation-popover-max-block)] w-[min(var(--generation-other-popover-width),var(--generation-popover-max-inline))] overflow-y-auto rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding)] text-popover-foreground shadow-2xl"
			>
				<SecondaryParamSettings params={params} values={values} onChange={onChange} />
			</PopoverContent>
		</Popover>
	);
};

export const SecondaryParamSettings: React.FC<{
	className?: string;
	onChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	values: Record<string, unknown>;
}> = ({ className, onChange, params, values }) => (
	<div className={cn("grid gap-2", className)}>
		<header className="flex min-w-0 items-center gap-1.5 px-1">
			<SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
			<h3 className="text-xs font-semibold text-muted-foreground">其他设置</h3>
		</header>
		<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
			{params.map((param) => (
				<SecondaryParamRow
					key={param.name}
					param={param}
					value={values[param.name]}
					onChange={(value) => onChange(param.name, value)}
				/>
			))}
		</div>
	</div>
);

const SecondaryParamRow: React.FC<{
	onChange: (value: unknown) => void;
	param: GenerationParam;
	value: unknown;
}> = ({ onChange, param, value }) => {
	const label = paramLabel(param.label);
	const help = param.help ? paramHelp(param.help) : undefined;

	return (
		<div className="inline-grid min-w-[11rem] grid-cols-[max-content_auto] items-center gap-2 rounded-[var(--generation-control-radius)] px-1.5 py-1 transition-colors hover:bg-muted/50">
			<div className="min-w-0 max-w-28">
				<p className="truncate text-xs font-semibold text-foreground" title={help}>
					{label}
				</p>
			</div>
			<SecondaryParamInput param={param} value={value} onChange={onChange} />
		</div>
	);
};

const SecondaryParamInput: React.FC<{
	onChange: (value: unknown) => void;
	param: GenerationParam;
	value: unknown;
}> = ({ onChange, param, value }) => {
	if (param.type === "select") {
		const options = param.options ?? [];
		const selectedValue = String(value ?? param.default ?? options[0]?.value ?? "");

		return (
			<label className="relative inline-flex h-[var(--generation-control-height)] min-w-[var(--generation-other-control-min-width)] shrink-0 items-center rounded-[var(--generation-control-radius)] bg-muted transition-colors hover:bg-ide-list-hover focus-within:ring-2 focus-within:ring-ring">
				<span className="sr-only">{paramLabel(param.label)}</span>
				<select
					value={selectedValue}
					className="h-full w-full appearance-none rounded-[var(--generation-control-radius)] border-0 bg-transparent py-0 pl-2 pr-7 text-xs font-semibold text-foreground outline-none"
					onChange={(event) => onChange(event.target.value)}
				>
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{paramOptionLabel(option.label)}
						</option>
					))}
				</select>
				<ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
			</label>
		);
	}

	if (param.type === "boolean") {
		const enabled = Boolean(value ?? param.default);

		return (
			<button
				type="button"
				role="switch"
				aria-checked={enabled}
				className={cn(
					"relative h-[var(--generation-other-switch-height)] w-[var(--generation-other-switch-width)] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					enabled ? "bg-primary" : "bg-muted",
				)}
				onClick={() => onChange(!enabled)}
			>
				<span
					className={cn(
						"absolute top-[var(--generation-other-switch-thumb-offset)] size-[var(--generation-other-switch-thumb-size)] rounded-full bg-card shadow-md transition-transform",
						enabled
							? "translate-x-[var(--generation-other-switch-thumb-checked-x)]"
							: "translate-x-[var(--generation-other-switch-thumb-offset)]",
					)}
				/>
			</button>
		);
	}

	if (param.type === "number") {
		return (
			<input
				type="number"
				value={String(value ?? param.default ?? "")}
				min={param.min}
				max={param.max}
				className="h-[var(--generation-control-height)] w-[var(--generation-other-number-width)] shrink-0 rounded-[var(--generation-control-radius)] border-0 bg-muted px-2 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-ide-list-hover focus:ring-2 focus:ring-ring"
				onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
			/>
		);
	}

	return (
		<input
			value={String(value ?? param.default ?? "")}
			className="h-[var(--generation-control-height)] w-[var(--generation-other-text-width)] shrink-0 rounded-[var(--generation-control-radius)] border-0 bg-muted px-2 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-ide-list-hover focus:ring-2 focus:ring-ring"
			onChange={(event) => onChange(event.target.value)}
		/>
	);
};

export {
	ReferenceSelectionDialog,
	type ReferenceSelectionShortcutGroup,
	type ReferenceSelectionShortcutItem,
} from "./ReferenceSelectionDialog";
