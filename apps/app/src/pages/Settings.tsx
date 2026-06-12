import {
	IonContent,
	IonHeader,
	IonIcon,
	IonPage,
	IonTitle,
	IonToolbar,
} from "@ionic/react";
import { colorPaletteOutline } from "ionicons/icons";
import useSWR from "swr";
import { apiKeysKey, getAPIKeys } from "@/api/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useThemeStore } from "@/lib/stores/theme";

const getThemeLabel = (mode: string) => {
	if (mode === "light") return "浅色";
	if (mode === "dark") return "深色";
	return "跟随系统";
};

const Settings: React.FC = () => {
	const { data } = useSWR(apiKeysKey, getAPIKeys);
	const { mode, toggle } = useThemeStore();
	const providers = data?.providers ?? [];

	return (
		<IonPage>
			<IonHeader translucent>
				<IonToolbar>
					<IonTitle>设置</IonTitle>
				</IonToolbar>
			</IonHeader>
			<IonContent fullscreen className="app-content">
				<div className="mx-auto grid w-full max-w-[34rem] gap-4 p-4 pb-[calc(var(--space-lg)+env(safe-area-inset-bottom))]">
					<Card className="gap-4 rounded-md py-4">
						<CardHeader className="px-4">
							<div className="min-w-0">
								<CardDescription>主题</CardDescription>
								<CardTitle className="mt-1 text-lg">{getThemeLabel(mode)}</CardTitle>
							</div>
							<CardAction>
								<Button type="button" variant="outline" onClick={toggle}>
									<IonIcon aria-hidden="true" icon={colorPaletteOutline} />
									切换
								</Button>
							</CardAction>
						</CardHeader>
					</Card>

					<Card className="gap-4 rounded-md py-4">
						<CardHeader className="px-4">
							<CardDescription>API Key</CardDescription>
							<CardTitle className="text-lg">供应商</CardTitle>
						</CardHeader>
						<CardContent className="px-4">
							<div className="overflow-hidden rounded-md border border-border bg-background">
								{providers.map((provider) => (
									<div
										key={provider.id}
										className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-3 py-3 first:border-t-0"
									>
										<div className="min-w-0">
											<div className="truncate text-sm font-semibold leading-tight text-foreground">
												{provider.label}
											</div>
											<div className="mt-1 truncate text-xs leading-5 text-muted-foreground">
												{provider.masked ?? provider.description}
											</div>
										</div>
										<Badge variant={provider.configured ? "secondary" : "outline"}>
											{provider.configured ? "已配置" : "未配置"}
										</Badge>
									</div>
								))}
								{providers.length === 0 ? (
									<div className="px-3 py-4 text-sm text-muted-foreground">暂无配置项</div>
								) : null}
							</div>
						</CardContent>
					</Card>
				</div>
			</IonContent>
		</IonPage>
	);
};

export default Settings;
