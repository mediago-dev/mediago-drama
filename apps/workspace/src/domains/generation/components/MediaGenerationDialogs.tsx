import { Check, ChevronDown, Images, SlidersHorizontal } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { GenerationParam } from "@/domains/generation/api/generation";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
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
	param: GenerationParam;
	value: unknown;
}> = ({ label: triggerLabel, onChange, param, value }) => {
	const [open, setOpen] = useState(false);
	const options = param.options ?? [];
	const selectedValue = String(value ?? param.default ?? options[0]?.value ?? "");
	const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];
	const label = paramLabel(param.label);
	const controlLabel = triggerLabel ?? label;
	const selectedLabel = selectedOption ? paramOptionLabel(selectedOption.label) : "未选择";

	if (options.length === 0) return null;

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
				className="w-[min(var(--generation-primary-popover-width),var(--generation-popover-max-inline))] rounded-[var(--generation-popover-radius)] border-border bg-popover p-[var(--generation-popover-padding-lg)] text-popover-foreground shadow-xl"
			>
				<div className="mb-3">
					<p className="text-sm font-semibold">{label}</p>
					{param.help ? (
						<p className="mt-0.5 text-xs text-muted-foreground">{paramHelp(param.help)}</p>
					) : null}
				</div>
				<div className="grid grid-cols-2 gap-1.5">
					{options.map((option) => {
						const optionLabel = paramOptionLabel(option.label);
						const selected = option.value === selectedValue;

						return (
							<button
								key={option.value}
								type="button"
								className={cn(
									"flex h-[var(--generation-primary-option-height)] min-w-0 items-center justify-center rounded-[var(--generation-control-radius)] border px-[var(--generation-control-padding-x)] text-xs font-medium transition-colors",
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

const SecondaryParamSettings: React.FC<{
	onChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	values: Record<string, unknown>;
}> = ({ onChange, params, values }) => (
	<div className="grid gap-[var(--generation-composer-toolbar-gap)]">
		<header>
			<h3 className="px-1 text-sm font-semibold text-foreground">其他设置</h3>
		</header>
		<div className="grid gap-0.5">
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
		<div className="flex min-w-0 items-center justify-between gap-2 rounded-[var(--generation-control-radius)] px-1 py-1 hover:bg-muted/60">
			<div className="min-w-0">
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
			<label className="relative shrink-0">
				<span className="sr-only">{paramLabel(param.label)}</span>
				<select
					value={selectedValue}
					className="h-[var(--generation-other-control-height)] min-w-[var(--generation-other-control-min-width)] appearance-none rounded-[var(--generation-control-radius)] border border-input bg-card py-0 pl-2 pr-6 text-xs font-semibold text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
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
				className="h-[var(--generation-other-control-height)] w-[var(--generation-other-number-width)] shrink-0 rounded-[var(--generation-control-radius)] border border-input bg-card px-2 text-xs font-semibold text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
				onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
			/>
		);
	}

	return (
		<input
			value={String(value ?? param.default ?? "")}
			className="h-[var(--generation-other-control-height)] w-[var(--generation-other-text-width)] shrink-0 rounded-[var(--generation-control-radius)] border border-input bg-card px-2 text-xs font-semibold text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20"
			onChange={(event) => onChange(event.target.value)}
		/>
	);
};

export {
	ReferenceSelectionDialog,
	type ReferenceSelectionShortcutGroup,
	type ReferenceSelectionShortcutItem,
} from "./ReferenceSelectionDialog";
