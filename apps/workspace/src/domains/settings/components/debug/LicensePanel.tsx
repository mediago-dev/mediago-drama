import { BadgeCheck, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import type React from "react";
import { useState } from "react";
import useSWR from "swr";
import {
	type LicenseActivation,
	activateLicense,
	deactivateLicense,
	getLicenseStatus,
	licenseStatusKey,
} from "@/domains/settings/api/license";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useDesktopWindowDrag } from "@/domains/workspace/lib/desktop-window-drag";
import { useToast } from "@/hooks/useToast";

export const LicensePanel: React.FC = () => {
	const toast = useToast();
	const {
		data: status,
		isLoading,
		mutate: mutateStatus,
	} = useSWR(licenseStatusKey, getLicenseStatus);
	const [code, setCode] = useState("");
	const [isActivating, setIsActivating] = useState(false);
	const [busyLicenseId, setBusyLicenseId] = useState<string>();
	const startWindowDrag = useDesktopWindowDrag();

	const activations = status?.activations ?? [];
	const configured = status?.configured ?? false;

	const submitActivation = async () => {
		const trimmed = code.trim();
		if (!trimmed) return;
		setIsActivating(true);
		try {
			const next = await activateLicense(trimmed);
			await mutateStatus(next, { revalidate: false });
			setCode("");
			toast.success("激活成功", { description: "已添加一个授权。" });
		} catch (error) {
			toast.error("激活失败", { description: errorMessage(error) });
		} finally {
			setIsActivating(false);
		}
	};

	const removeActivation = async (licenseId: string) => {
		setBusyLicenseId(licenseId);
		try {
			const next = await deactivateLicense(licenseId);
			await mutateStatus(next, { revalidate: false });
			toast.success("已取消该激活");
		} catch (error) {
			toast.error("取消激活失败", { description: errorMessage(error) });
		} finally {
			setBusyLicenseId(undefined);
		}
	};

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-ide-editor text-ide-editor-foreground">
			<header
				className="shrink-0 border-b border-border bg-ide-editor px-5 py-4"
				data-desktop-drag-region
				onPointerDown={startWindowDrag}
			>
				<div className="flex items-center gap-2">
					<KeyRound className="size-4 text-muted-foreground" />
					<h2 className="truncate text-sm font-semibold text-foreground">授权激活</h2>
				</div>
				<p className="mt-1 text-xs text-muted-foreground">
					分别输入「进入软件」和「购买提示词包」的激活码，多个激活可同时生效。
				</p>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				{isLoading && !status ? (
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						加载授权状态
					</span>
				) : (
					<div className="max-w-xl space-y-3">
						{!configured ? (
							<p className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
								<ShieldOff className="size-4 shrink-0" />
								未配置授权服务器，暂时无法激活。
							</p>
						) : (
							<p className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
								{status?.hasAppAccess ? (
									<ShieldCheck className="size-4 shrink-0 text-success-foreground" />
								) : (
									<ShieldOff className="size-4 shrink-0" />
								)}
								{status?.hasAppAccess ? "已激活「进入软件」授权。" : "尚未激活「进入软件」授权。"}
							</p>
						)}

						<form
							className="space-y-3 rounded-md border border-border bg-card p-4"
							onSubmit={(event) => {
								event.preventDefault();
								void submitActivation();
							}}
						>
							<div>
								<h3 className="text-sm font-medium text-foreground">添加激活码</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									输入购买后获得的激活码。软件激活码开启使用权限，提示词包激活码解锁对应的 Pro 包。
								</p>
							</div>
							<div className="flex items-center gap-2">
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
									className="shrink-0"
									disabled={!configured || isActivating || !code.trim()}
								>
									{isActivating ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<KeyRound className="size-4" />
									)}
									<span>{isActivating ? "激活中" : "激活"}</span>
								</Button>
							</div>
						</form>

						{activations.length > 0 ? (
							<div className="space-y-2">
								<p className="text-xs text-muted-foreground">已激活（{activations.length}）</p>
								{activations.map((activation) => (
									<ActivationCard
										key={activation.licenseId}
										activation={activation}
										busy={busyLicenseId === activation.licenseId}
										onDeactivate={() => void removeActivation(activation.licenseId)}
									/>
								))}
							</div>
						) : null}
					</div>
				)}
			</div>
		</section>
	);
};

const ActivationCard: React.FC<{
	activation: LicenseActivation;
	busy: boolean;
	onDeactivate: () => void;
}> = ({ activation, busy, onDeactivate }) => (
	<div className="space-y-2 rounded-md border border-border bg-card p-4">
		<div className="flex flex-wrap items-center gap-2">
			<BadgeCheck className="size-4 text-muted-foreground" />
			<span className="text-sm font-medium text-foreground">
				{activation.expired ? "已过期" : "已激活"}
			</span>
			{activation.plan ? <Badge variant="secondary">{activation.plan}</Badge> : null}
		</div>
		<div className="space-y-1 text-xs text-muted-foreground">
			<p>授权编号：{activation.licenseId}</p>
			<p>到期时间：{formatExpiresAt(activation.expiresAt)}</p>
		</div>
		{activation.entitlements && activation.entitlements.length > 0 ? (
			<div className="flex flex-wrap items-center gap-1.5">
				{activation.entitlements.map((entitlement) => (
					<Badge key={entitlement} variant="outline">
						{entitlement}
					</Badge>
				))}
			</div>
		) : null}
		<Button type="button" variant="outline" size="sm" disabled={busy} onClick={onDeactivate}>
			{busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
			<span>{busy ? "取消中" : "取消激活"}</span>
		</Button>
	</div>
);

const formatExpiresAt = (value?: string) => {
	if (!value) return "长期有效";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleString();
};

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "请稍后重试。";
};
