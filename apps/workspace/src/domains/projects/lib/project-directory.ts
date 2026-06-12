export const pickProjectDirectory = async (): Promise<string | null> => {
	if (isTauriRuntime()) {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				directory: true,
				multiple: false,
				title: "选择项目文件夹",
			});
			if (Array.isArray(selected)) return selected[0] ?? null;
			return selected ?? null;
		} catch {
			return promptForProjectDirectory();
		}
	}

	return promptForProjectDirectory();
};

export const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

export const openProjectDirectory = async (projectDir: string) => {
	const safeProjectDir = projectDir.trim();
	if (!safeProjectDir) throw new Error("项目文件夹路径为空。");
	if (!isTauriRuntime()) throw new Error("当前运行环境不支持打开本地文件夹。");

	const { openPath, revealItemInDir } = await import("@tauri-apps/plugin-opener");
	try {
		await revealItemInDir(safeProjectDir);
	} catch {
		await openPath(safeProjectDir);
	}
};

const promptForProjectDirectory = () => {
	const value = window.prompt("请输入项目文件夹的绝对路径");
	return value?.trim() || null;
};
