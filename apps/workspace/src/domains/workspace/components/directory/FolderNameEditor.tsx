import { ChevronRight, Folder } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { directoryTreeRowIndent } from "./layout";

export const FolderNameEditor: React.FC<{
	defaultValue: string;
	depth: number;
	onCancel: () => void;
	onCommit: (name: string) => void;
	placeholder?: string;
	showDisclosureSpacer?: boolean;
}> = ({ defaultValue, depth, onCancel, onCommit, placeholder, showDisclosureSpacer = false }) => {
	const [name, setName] = useState(defaultValue);
	const inputRef = useRef<HTMLInputElement>(null);
	const didCloseRef = useRef(false);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	const commit = () => {
		if (didCloseRef.current) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			cancel();
			return;
		}
		didCloseRef.current = true;
		onCommit(trimmedName);
	};

	const cancel = () => {
		if (didCloseRef.current) return;
		didCloseRef.current = true;
		onCancel();
	};

	return (
		<div
			className="flex h-7 w-full items-center gap-1.5 rounded-sm pr-1 text-xs text-muted-foreground"
			style={{ paddingLeft: directoryTreeRowIndent(depth) }}
		>
			{showDisclosureSpacer ? (
				<span className="flex size-3 shrink-0 items-center justify-center" aria-hidden="true">
					<ChevronRight className="size-3" />
				</span>
			) : null}
			<Folder className="size-3.5 shrink-0" />
			<Input
				ref={inputRef}
				value={name}
				onChange={(event) => setName(event.target.value)}
				onBlur={commit}
				placeholder={placeholder}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						cancel();
					}
				}}
				className="h-6 min-w-0 flex-1 px-1.5 py-1 text-xs placeholder:text-muted-foreground"
				aria-label="文件夹名称"
			/>
		</div>
	);
};
