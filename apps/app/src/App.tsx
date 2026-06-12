import { Redirect, Route, useLocation } from "react-router-dom";
import {
	IonApp,
	IonIcon,
	IonLabel,
	IonRouterOutlet,
	IonTabBar,
	IonTabButton,
	IonTabs,
	setupIonicReact,
} from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { imagesOutline, settingsOutline, sparklesOutline } from "ionicons/icons";
import Generate from "@/pages/Generate";
import GenerationSession from "@/pages/GenerationSession";
import History from "@/pages/History";
import HistoryDetail from "@/pages/HistoryDetail";
import Settings from "@/pages/Settings";

/* Core CSS required for Ionic components to work properly */
import "@ionic/react/css/core.css";

/* Basic CSS for apps built with Ionic */
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";

/* Optional CSS utils that can be commented out */
import "@ionic/react/css/padding.css";
import "@ionic/react/css/float-elements.css";
import "@ionic/react/css/text-alignment.css";
import "@ionic/react/css/text-transformation.css";
import "@ionic/react/css/flex-utils.css";
import "@ionic/react/css/display.css";

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* import '@ionic/react/css/palettes/dark.always.css'; */
/* import '@ionic/react/css/palettes/dark.class.css'; */

/* Theme variables */
import "@/theme/variables.css";

setupIonicReact();

const tabRootPaths = new Set(["/generate", "/history", "/settings"]);

const AppTabs: React.FC = () => {
	const location = useLocation();
	const pathname = location.pathname.replace(/\/$/, "") || "/";
	const showTabBar = tabRootPaths.has(pathname);

	return (
		<IonTabs>
			<IonRouterOutlet>
				<Route exact path="/generate">
					<Generate />
				</Route>
				<Route exact path="/generate/:kind/:conversationId">
					<GenerationSession />
				</Route>
				<Route exact path="/generate/:kind">
					<GenerationSession />
				</Route>
				<Route exact path="/history">
					<History />
				</Route>
				<Route exact path="/history/:id">
					<HistoryDetail />
				</Route>
				<Route exact path="/settings">
					<Settings />
				</Route>
				<Route exact path="/">
					<Redirect to="/generate" />
				</Route>
			</IonRouterOutlet>
			{showTabBar ? (
				<IonTabBar slot="bottom">
					<IonTabButton tab="generate" href="/generate">
						<IonIcon aria-hidden="true" icon={sparklesOutline} />
						<IonLabel>生成</IonLabel>
					</IonTabButton>
					<IonTabButton tab="history" href="/history">
						<IonIcon aria-hidden="true" icon={imagesOutline} />
						<IonLabel>历史</IonLabel>
					</IonTabButton>
					<IonTabButton tab="settings" href="/settings">
						<IonIcon aria-hidden="true" icon={settingsOutline} />
						<IonLabel>设置</IonLabel>
					</IonTabButton>
				</IonTabBar>
			) : null}
		</IonTabs>
	);
};

const App: React.FC = () => (
	<IonApp>
		<IonReactRouter>
			<AppTabs />
		</IonReactRouter>
	</IonApp>
);

export default App;
