import { openNativePath, pickDesktopDirectory, revealNativePath } from "@/shared/desktop/actions";
import { isDesktopRuntime as detectDesktopRuntime } from "@/shared/desktop/runtime";

export const pickProjectDirectory = async (): Promise<string | null> => {
	if (detectDesktopRuntime()) {
		try {
			return await pickDesktopDirectory("选择项目文件夹");
		} catch {
			return promptForProjectDirectory();
		}
	}

	return promptForProjectDirectory();
};

export { detectDesktopRuntime as isDesktopRuntime };

export const openProjectDirectory = async (projectDir: string) => {
	const safeProjectDir = projectDir.trim();
	if (!safeProjectDir) throw new Error("项目文件夹路径为空。");
	if (!detectDesktopRuntime()) throw new Error("当前运行环境不支持打开本地文件夹。");

	try {
		await revealNativePath(safeProjectDir);
	} catch {
		await openNativePath(safeProjectDir);
	}
};

const promptForProjectDirectory = () => {
	const value = window.prompt("请输入项目文件夹的绝对路径");
	return value?.trim() || null;
};
