import { KeyRound, Loader2, ShieldOff } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { type LicenseStatus, activateLicense } from "@/domains/settings/api/license";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

// ActivationWall is the full-screen gate shown by Pro builds until a valid
// license is activated. It never renders in community builds.
export const ActivationWall: React.FC<{
	status?: LicenseStatus;
	onActivated: (status: LicenseStatus) => void;
}> = ({ status, onActivated }) => {
	const toast = useToast();
	const startWindowDrag = useDesktopWindowDrag();
	const [code, setCode] = useState("");
	const [isActivating, setIsActivating] = useState(false);
	const configured = status?.configured ?? false;

	const submit = async () => {
		const trimmed = code.trim();
		if (!trimmed) return;
		setIsActivating(true);
		try {
			const next = await activateLicense(trimmed);
			toast.success("激活成功", {
				description: next.hasAppAccess ? "已获得进入软件的授权。" : "激活已添加。",
			});
			onActivated(next);
		} catch (error) {
			toast.error("激活失败", { description: errorMessage(error) });
		} finally {
			setIsActivating(false);
		}
	};

	return (
		<div
			className="flex h-screen w-screen flex-col items-center justify-center bg-background px-6"
			data-desktop-drag-region
			onPointerDown={startWindowDrag}
		>
			<div
				className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
				onPointerDown={(event) => event.stopPropagation()}
			>
				<div className="space-y-1.5 text-center">
					<div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
						<KeyRound className="size-5 text-muted-foreground" />
					</div>
					<h1 className="text-base font-semibold text-foreground">激活以使用 MediaGo Drama</h1>
					<p className="text-xs text-muted-foreground">
						本版本为商业授权版，请输入「进入软件」的激活码后继续。
					</p>
				</div>
				{!configured ? (
					<p className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
						<ShieldOff className="size-4 shrink-0" />
						未配置授权服务器，无法激活，请联系管理员。
					</p>
				) : null}
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<Input
						aria-label="激活码"
						placeholder="请输入激活码"
						value={code}
						autoComplete="off"
						disabled={!configured || isActivating}
						onChange={(event) => setCode(event.currentTarget.value)}
					/>
					<Button
						type="submit"
						className="w-full"
						disabled={!configured || isActivating || !code.trim()}
					>
						{isActivating ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<KeyRound className="size-4" />
						)}
						<span>{isActivating ? "激活中" : "激活并进入"}</span>
					</Button>
				</form>
			</div>
		</div>
	);
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
