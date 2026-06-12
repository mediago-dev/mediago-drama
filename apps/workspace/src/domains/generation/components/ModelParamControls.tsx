import type React from "react";
import type { GenerationParam } from "@/domains/generation/api/generation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/shared/components/ui/select";
import {
	paramHelp,
	paramLabel,
	paramOptionLabel,
} from "@/domains/generation/hooks/useGenerationWorkspace.helpers";
import { cn } from "@/shared/lib/utils";

export const ModelParamControls: React.FC<{
	compact?: boolean;
	onChange: (name: string, value: unknown) => void;
	params: GenerationParam[];
	values: Record<string, unknown>;
}> = ({ compact, onChange, params, values }) => {
	if (params.length === 0) return null;

	return (
		<div
			className={cn(
				"grid gap-3",
				compact ? "grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))]" : undefined,
			)}
		>
			{params.map((param) => (
				<div key={param.name}>
					<Label className="mb-2 block text-xs text-muted-foreground">
						{paramLabel(param.label)}
					</Label>
					<ParamInput
						param={param}
						value={values[param.name]}
						onChange={(value) => onChange(param.name, value)}
					/>
					{param.help ? (
						<p className="mt-1 text-xs leading-4 text-muted-foreground">{paramHelp(param.help)}</p>
					) : null}
				</div>
			))}
		</div>
	);
};

const ParamInput: React.FC<{
	onChange: (value: unknown) => void;
	param: GenerationParam;
	value: unknown;
}> = ({ onChange, param, value }) => {
	if (param.type === "select") {
		return (
			<Select value={String(value ?? "")} onValueChange={onChange}>
				<SelectTrigger
					aria-label={paramLabel(param.label)}
					className="h-9 rounded-md text-foreground"
				>
					<SelectValue placeholder={paramLabel(param.label)} />
				</SelectTrigger>
				<SelectContent align="start">
					{(param.options ?? []).map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{paramOptionLabel(option.label)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	if (param.type === "number") {
		return (
			<Input
				type="number"
				value={String(value ?? "")}
				min={param.min}
				max={param.max}
				onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
				className="h-9 rounded-md text-foreground"
			/>
		);
	}

	if (param.type === "boolean") {
		const enabled = Boolean(value);
		return (
			<Button
				type="button"
				variant={enabled ? "default" : "outline"}
				size="sm"
				className="w-full justify-center"
				onClick={() => onChange(!enabled)}
			>
				{enabled ? "开启" : "关闭"}
			</Button>
		);
	}

	return (
		<Input
			value={String(value ?? "")}
			onChange={(event) => onChange(event.target.value)}
			className="h-9 rounded-md text-foreground"
		/>
	);
};
