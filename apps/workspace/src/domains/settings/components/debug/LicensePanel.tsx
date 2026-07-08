import { BadgeCheck, KeyRound, Loader2, ShieldOff } from "lucide-react";
import type React from "react";
import { useState } from "react";
import useSWR from "swr";
import {
	type LicenseStatus,
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
	const [isDeactivating, setIsDeactivating] = useState(false);
	const startWindowDrag = useDesktopWindowDrag();

	const submitActivation = async () => {
		const trimmed = code.trim();
		if (!trimmed) return;
		setIsActivating(true);
		try {
			const next = await activateLicense(trimmed);
			await mutateStatus(next, { revalidate: false });
			setCode("");
			toast.success("激活成功", { description: planLabel(next) });
		} catch (error) {
			toast.error("激活失败", { description: errorMessage(error) });
		} finally {
			setIsActivating(false);
		}
	};

	const removeActivation = async () => {
		setIsDeactivating(true);
		try {
			const next = await deactivateLicense();
			await mutateStatus(next, { revalidate: false });
			toast.success("已取消激活", { description: "商业授权功能已停用。" });
		} catch (error) {
			toast.error("取消激活失败", { description: errorMessage(error) });
		} finally {
			setIsDeactivating(false);
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
				<p className="mt-1 text-xs text-muted-foreground">输入激活码以启用商业授权功能。</p>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				{isLoading && !status ? (
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						加载授权状态
					</span>
				) : status?.activated ? (
					<ActivatedCard
						deactivating={isDeactivating}
						status={status}
						onDeactivate={() => void removeActivation()}
					/>
				) : (
					<div className="max-w-xl space-y-3">
						{status && !status.configured ? (
							<p className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
								<ShieldOff className="size-4 shrink-0" />
								未配置授权服务器，暂时无法激活。
							</p>
						) : null}
						<form
							className="space-y-3 rounded-md border border-border bg-card p-4"
							onSubmit={(event) => {
								event.preventDefault();
								void submitActivation();
							}}
						>
							<div>
								<h3 className="text-sm font-medium text-foreground">激活商业授权</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									输入购买后获得的激活码，激活后即可使用商业提示词包等功能。
								</p>
							</div>
							<div className="flex items-center gap-2">
								<Input
									aria-label="激活码"
									placeholder="请输入激活码"
									value={code}
									autoComplete="off"
									disabled={!status?.configured || isActivating}
									onChange={(event) => setCode(event.currentTarget.value)}
								/>
								<Button
									type="submit"
									className="shrink-0"
									disabled={!status?.configured || isActivating || !code.trim()}
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
					</div>
				)}
			</div>
		</section>
	);
};

const ActivatedCard: React.FC<{
	deactivating: boolean;
	onDeactivate: () => void;
	status: LicenseStatus;
}> = ({ deactivating, onDeactivate, status }) => (
	<div className="max-w-xl space-y-3 rounded-md border border-border bg-card p-4">
		<div className="flex flex-wrap items-center gap-2">
			<BadgeCheck className="size-4 text-muted-foreground" />
			<span className="text-sm font-medium text-foreground">已激活</span>
			{status.plan ? <Badge variant="secondary">{status.plan}</Badge> : null}
		</div>
		<div className="space-y-1 text-xs text-muted-foreground">
			{status.licenseId ? <p>授权编号：{status.licenseId}</p> : null}
			<p>到期时间：{formatExpiresAt(status.expiresAt)}</p>
		</div>
		{status.entitlements && status.entitlements.length > 0 ? (
			<div className="space-y-1.5">
				<p className="text-xs text-muted-foreground">已授权功能</p>
				<div className="flex flex-wrap items-center gap-1.5">
					{status.entitlements.map((entitlement) => (
						<Badge key={entitlement} variant="outline">
							{entitlement}
						</Badge>
					))}
				</div>
			</div>
		) : null}
		<Button type="button" variant="outline" disabled={deactivating} onClick={onDeactivate}>
			{deactivating ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<ShieldOff className="size-4" />
			)}
			<span>{deactivating ? "取消中" : "取消激活"}</span>
		</Button>
	</div>
);

const planLabel = (status: LicenseStatus) =>
	status.plan ? `当前方案：${status.plan}` : "商业授权已生效。";

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
