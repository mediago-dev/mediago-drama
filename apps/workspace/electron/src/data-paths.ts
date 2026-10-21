import { join } from "node:path";

export const resolveAppDataPaths = (packaged: boolean, appDataDir: string, homeDir: string) => {
	const root = packaged
		? join(appDataDir, "mediago-drama-oss")
		: join(homeDir, "mediago-drama-oss-dev");
	const userData = join(root, "electron");
	return {
		workspace: join(root, "workspace"),
		userData,
		sessionData: join(userData, "session"),
	};
};
