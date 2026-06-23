# Tauri To Electron Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `apps/workspace` Tauri desktop shell with an Electron shell while preserving the existing React workspace, local Go server sidecar, bundled agents/tools, native dialogs, open-path behavior, notifications, and desktop window ergonomics.

**Architecture:** Add Electron beside Tauri first, route renderer-native calls through a narrow desktop adapter, then remove Tauri once Electron dev/build parity is verified. Electron owns native process lifecycle in the main process, exposes a typed preload API, and keeps the React app browser-compatible by falling back when no desktop runtime is present.

**Tech Stack:** React 19, Vite 8, TypeScript, pnpm, Electron, electron-builder, Node `child_process`, Go sidecar binaries, Vitest, oxlint/oxfmt, go-task.

---

## Migration Strategy

Do this in three phases:

1. **Parallel shell:** Add Electron without deleting Tauri. The web app keeps running in browser and Tauri while Electron is brought up.
2. **Adapter cutover:** Replace direct `@tauri-apps/*` imports with `src/shared/desktop/*` APIs backed by Electron preload or browser fallback.
3. **Tauri removal:** Delete `src-tauri`, Tauri dependencies, Tauri scripts, and Tauri docs after Electron dev/build and tests pass.

Avoid changing product behavior during the migration. Rename internal CSS/classes later only if needed; keeping `tauri-` class names temporarily is acceptable until Electron parity is proven.

---

### Task 1: Add Electron Dependencies And Scripts

**Files:**
- Modify: `apps/workspace/package.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Add dependencies**

Run:

```bash
pnpm -C apps/workspace add -D electron electron-builder concurrently wait-on cross-env
```

Expected: `apps/workspace/package.json` and `pnpm-lock.yaml` update.

**Step 2: Add package scripts**

Modify `apps/workspace/package.json` scripts:

```json
{
  "dev:electron:web": "vite --host 127.0.0.1 --port 31420 --strictPort",
  "electron:compile": "tsc -p electron/tsconfig.json",
  "electron:dev": "concurrently -k \"pnpm dev:electron:web\" \"wait-on http://127.0.0.1:31420 && pnpm electron:compile && cross-env ELECTRON_RENDERER_URL=http://127.0.0.1:31420 electron electron/dist/main.js\"",
  "electron:build": "pnpm build && pnpm electron:compile && electron-builder"
}
```

Keep the existing Tauri scripts for now.

**Step 3: Verify install and scripts parse**

Run:

```bash
pnpm -C apps/workspace exec electron --version
pnpm -C apps/workspace exec electron-builder --version
```

Expected: both commands print versions.

**Step 4: Commit**

```bash
git add apps/workspace/package.json pnpm-lock.yaml
git commit -m "chore(desktop): add electron tooling"
```

---

### Task 2: Add Electron TypeScript Build Config

**Files:**
- Create: `apps/workspace/electron/tsconfig.json`
- Modify: `apps/workspace/tsconfig.json` if needed

**Step 1: Create Electron tsconfig**

Create `apps/workspace/electron/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "electron"],
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": false,
    "allowImportingTsExtensions": false
  },
  "include": ["*.ts", "**/*.ts"]
}
```

If the root `apps/workspace/tsconfig.json` has settings that prevent NodeNext compilation, keep this Electron config self-contained.

**Step 2: Verify empty compile fails for missing inputs**

Run:

```bash
pnpm -C apps/workspace electron:compile
```

Expected: FAIL because Electron source files do not exist yet.

**Step 3: Commit after Task 3 instead**

No commit yet; Task 3 will add the source files that make this compile.

---

### Task 3: Add Minimal Electron Main And Preload

**Files:**
- Create: `apps/workspace/electron/main.ts`
- Create: `apps/workspace/electron/preload.ts`
- Create: `apps/workspace/electron/paths.ts`
- Modify: `apps/workspace/electron/tsconfig.json`

**Step 1: Implement runtime paths**

Create `apps/workspace/electron/paths.ts`:

```ts
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const electronDir = dirname(fileURLToPath(import.meta.url));

export const workspaceDir = resolve(electronDir, "..", "..");
export const rootDir = resolve(workspaceDir, "../..");
export const isPackaged = () => app.isPackaged;

export const rendererDistDir = () => join(workspaceDir, "dist");
export const preloadPath = () => join(electronDir, "preload.js");

export const resourceRoot = () =>
  isPackaged() ? process.resourcesPath : join(workspaceDir, "electron", "resources");

export const serverBinaryPath = () => {
  const binary = process.platform === "win32" ? "mediago-server.exe" : "mediago-server";
  return join(resourceRoot(), "bin", binary);
};

export const agentsDir = () => join(resourceRoot(), "agents");
export const toolsDir = () => join(resourceRoot(), "tools");
```

**Step 2: Implement preload API stub**

Create `apps/workspace/electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

const api = {
  platform: process.platform,
  isElectron: true,
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url),
  openPath: (path: string) => ipcRenderer.invoke("desktop:open-path", path),
  revealPath: (path: string) => ipcRenderer.invoke("desktop:reveal-path", path),
  pickDirectory: (options?: { title?: string }) =>
    ipcRenderer.invoke("desktop:pick-directory", options),
  showNotification: (options: { title: string; body?: string }) =>
    ipcRenderer.invoke("desktop:show-notification", options),
  startWindowDrag: () => ipcRenderer.invoke("desktop:start-window-drag")
};

contextBridge.exposeInMainWorld("mediagoDesktop", api);
```

**Step 3: Implement minimal main process**

Create `apps/workspace/electron/main.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, Notification, shell } from "electron";
import { preloadPath, rendererDistDir } from "./paths.js";

let mainWindow: BrowserWindow | null = null;

const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    title: "MediaGo Drama",
    width: 1280,
    height: 905,
    minWidth: 960,
    minHeight: 680,
    center: true,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 25 },
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(join(rendererDistDir(), "index.html"));
  }
};

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  else mainWindow?.show();
});

ipcMain.handle("desktop:open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("desktop:open-path", async (_event, path: string) => {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
});

ipcMain.handle("desktop:reveal-path", (_event, path: string) => {
  shell.showItemInFolder(path);
});

ipcMain.handle("desktop:pick-directory", async (_event, options?: { title?: string }) => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: options?.title,
    properties: ["openDirectory"]
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("desktop:show-notification", (_event, options: { title: string; body?: string }) => {
  if (!Notification.isSupported()) return false;
  new Notification({ title: options.title, body: options.body }).show();
  return true;
});

ipcMain.handle("desktop:start-window-drag", () => {
  // Electron supports CSS app-region for dragging. Renderer calls can be no-ops.
});

await app.whenReady();
await createWindow();
```

**Step 4: Verify compile**

Run:

```bash
pnpm -C apps/workspace electron:compile
```

Expected: PASS and `apps/workspace/electron/dist/main.js` exists.

**Step 5: Commit**

```bash
git add apps/workspace/electron apps/workspace/package.json pnpm-lock.yaml
git commit -m "feat(desktop): add electron shell"
```

---

### Task 4: Stage Electron Sidecar Resources

**Files:**
- Create: `apps/workspace/scripts/stage-electron.ts`
- Modify: `Taskfile.yml`

**Step 1: Create stage script**

Create `apps/workspace/scripts/stage-electron.ts` based on `apps/workspace/scripts/stage-tauri.ts`, but remove Rust triple handling:

```ts
import { constants, accessSync, chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agent = process.argv[2]?.trim() || "codex";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const rootDir = resolve(workspaceDir, "../..");
const hostBinaryExt = process.platform === "win32" ? ".exe" : "";
const serverBin = join(rootDir, "bin", `mediago-server${hostBinaryExt}`);
const agentDist = join(rootDir, "packages", "vendor", "dist", agent);
const toolsDist = join(rootDir, "packages", "vendor", "dist", "tools");
const electronResourcesDir = join(workspaceDir, "electron", "resources");

function main(): void {
  ensureExecutable(serverBin);
  ensureFile(join(agentDist, "agent.json"), `missing prepared agent: ${join(agentDist, "agent.json")}`);
  ensureFile(join(toolsDist, "ffmpeg", "tool.json"), `missing prepared ffmpeg: ${join(toolsDist, "ffmpeg", "tool.json")}`);
  ensureFile(join(toolsDist, "ffprobe", "tool.json"), `missing prepared ffprobe: ${join(toolsDist, "ffprobe", "tool.json")}`);
  ensureFile(join(toolsDist, "dreamina", "tool.json"), `missing prepared dreamina: ${join(toolsDist, "dreamina", "tool.json")}`);

  const binDir = join(electronResourcesDir, "bin");
  const agentsDir = join(electronResourcesDir, "agents");
  const toolsDir = join(electronResourcesDir, "tools");
  const stagedServer = join(binDir, `mediago-server${hostBinaryExt}`);

  rmSync(electronResourcesDir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(toolsDir, { recursive: true });

  cpSync(serverBin, stagedServer);
  chmodSync(stagedServer, 0o755);
  cpSync(agentDist, join(agentsDir, agent), { recursive: true });
  cpSync(toolsDist, toolsDir, { recursive: true });
}

function ensureExecutable(path: string): void {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new Error(`missing server binary: ${path}`);
  }
}

function ensureFile(path: string, message: string): void {
  if (!existsSync(path)) throw new Error(message);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

**Step 2: Add Taskfile target**

Modify `Taskfile.yml`:

```yaml
  stage-electron:
    cmds:
      - node apps/workspace/scripts/stage-electron.ts {{.AGENT}}
```

**Step 3: Verify staging**

Run:

```bash
task build:server
task prepare-agent AGENT=opencode
task prepare-media-tools
task stage-electron AGENT=opencode
test -x apps/workspace/electron/resources/bin/mediago-server
test -f apps/workspace/electron/resources/agents/opencode/agent.json
test -f apps/workspace/electron/resources/tools/ffmpeg/tool.json
```

Expected: all commands pass.

**Step 4: Commit**

```bash
git add Taskfile.yml apps/workspace/scripts/stage-electron.ts
git commit -m "feat(desktop): stage electron sidecar resources"
```

---

### Task 5: Start And Stop The Go Sidecar In Electron

**Files:**
- Create: `apps/workspace/electron/sidecar.ts`
- Modify: `apps/workspace/electron/main.ts`
- Modify: `apps/workspace/electron/paths.ts`

**Step 1: Add sidecar module**

Create `apps/workspace/electron/sidecar.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { agentsDir, serverBinaryPath, toolsDir } from "./paths.js";

let child: ChildProcessWithoutNullStreams | null = null;

export const startServerSidecar = () => {
  if (process.env.ELECTRON_RENDERER_URL) return;
  if (child) return;

  const serverPath = serverBinaryPath();
  if (!existsSync(serverPath)) {
    throw new Error(`missing server sidecar: ${serverPath}`);
  }

  child = spawn(serverPath, ["--config", "configs/server.yaml"], {
    env: {
      ...process.env,
      MEDIAGO_AGENT_ID: process.env.MEDIAGO_AGENT_ID || "opencode",
      MEDIAGO_SERVER_PORT: process.env.MEDIAGO_SERVER_PORT || "48273",
      MEDIAGO_EXIT_ON_STDIN_CLOSE: "1",
      MEDIAGO_AGENT_BIN_DIR: agentsDir(),
      MEDIAGO_FFMPEG_BIN_DIR: toolsDir(),
      MEDIAGO_JIMENG_BIN_DIR: toolsDir()
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => console.info(`[mediago-server] ${String(chunk).trimEnd()}`));
  child.stderr.on("data", (chunk) => console.error(`[mediago-server] ${String(chunk).trimEnd()}`));
  child.on("exit", () => {
    child = null;
  });
};

export const stopServerSidecar = () => {
  const current = child;
  child = null;
  current?.kill();
};
```

Check the server binary's packaged working directory expectations. If `--config configs/server.yaml` does not resolve in packaged Electron, adjust `spawn` `cwd` and include config resources in Task 6.

**Step 2: Wire lifecycle**

Modify `apps/workspace/electron/main.ts`:

```ts
import { startServerSidecar, stopServerSidecar } from "./sidecar.js";

app.on("before-quit", stopServerSidecar);

await app.whenReady();
startServerSidecar();
await createWindow();
```

For macOS, closing the last window should hide instead of quit if current Tauri behavior must be preserved:

```ts
mainWindow.on("close", (event) => {
  if (process.platform !== "darwin" || app.isQuitting) return;
  event.preventDefault();
  mainWindow?.hide();
});
```

Set `app.isQuitting` through a typed local flag rather than mutating `app` directly.

**Step 3: Verify dev mode still skips sidecar**

Run:

```bash
pnpm -C apps/workspace electron:dev
```

Expected: Electron opens the Vite dev app and does not start a packaged sidecar because `ELECTRON_RENDERER_URL` is set.

**Step 4: Commit**

```bash
git add apps/workspace/electron
git commit -m "feat(desktop): manage local server sidecar in electron"
```

---

### Task 6: Configure Electron Builder

**Files:**
- Modify: `apps/workspace/package.json`
- Create: `apps/workspace/build/entitlements.mac.plist` if signing needs hardened runtime later

**Step 1: Add build config**

Add to `apps/workspace/package.json`:

```json
{
  "main": "electron/dist/main.js",
  "build": {
    "appId": "team.torchstellar.mediagodrama",
    "productName": "MediaGo Drama",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/dist/**/*",
      "package.json"
    ],
    "extraResources": [
      {
        "from": "electron/resources",
        "to": "."
      }
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "target": ["dmg", "zip"],
      "icon": "src-tauri/icons/icon.icns"
    },
    "win": {
      "target": ["nsis", "zip"],
      "icon": "src-tauri/icons/icon.ico"
    },
    "linux": {
      "target": ["AppImage", "deb"],
      "icon": "src-tauri/icons"
    }
  }
}
```

Initially reuse the existing Tauri icons. Move icons to `apps/workspace/build/icons` during final cleanup.

**Step 2: Add root desktop build task**

Modify `Taskfile.yml`:

```yaml
  build:electron:
    desc: Build the Electron desktop app
    env:
      MEDIAGO_AGENT_ID: "{{.AGENT}}"
      MEDIAGO_SERVER_PORT: "{{.SERVER_PORT}}"
      VITE_MEDIAGO_SERVER_PORT: "{{.SERVER_PORT}}"
    cmds:
      - task: prepare-agent
        vars:
          AGENT: "{{.AGENT}}"
      - task: prepare-media-tools
      - task: workspace:build
      - task: build:server
      - task: stage-electron
        vars:
          AGENT: "{{.AGENT}}"
      - pnpm -C apps/workspace electron:build
```

Do not replace `build` yet.

**Step 3: Verify builder config**

Run:

```bash
task build:electron AGENT=opencode
```

Expected: Electron package artifacts are created under `apps/workspace/release`.

**Step 4: Commit**

```bash
git add Taskfile.yml apps/workspace/package.json
git commit -m "feat(desktop): package workspace with electron"
```

---

### Task 7: Add Typed Renderer Desktop Adapter

**Files:**
- Create: `apps/workspace/src/shared/desktop/types.ts`
- Create: `apps/workspace/src/shared/desktop/runtime.ts`
- Create: `apps/workspace/src/shared/desktop/actions.ts`
- Create: `apps/workspace/src/shared/desktop/window-drag.ts`
- Create: `apps/workspace/src/shared/desktop/runtime.test.ts`
- Modify: `apps/workspace/src/vite-env.d.ts` or create `apps/workspace/src/types/desktop.d.ts`

**Step 1: Add global type**

Create `apps/workspace/src/shared/desktop/types.ts`:

```ts
export interface MediagoDesktopAPI {
  platform: NodeJS.Platform;
  isElectron: true;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  pickDirectory(options?: { title?: string }): Promise<string | null>;
  showNotification(options: { title: string; body?: string }): Promise<boolean>;
  startWindowDrag(): Promise<void>;
}
```

Add global declaration:

```ts
import type { MediagoDesktopAPI } from "@/shared/desktop/types";

declare global {
  interface Window {
    mediagoDesktop?: MediagoDesktopAPI;
    __TAURI_INTERNALS__?: unknown;
  }
}
```

**Step 2: Add runtime detection**

Create `apps/workspace/src/shared/desktop/runtime.ts`:

```ts
export type DesktopRuntime = "electron" | "tauri" | "browser";

export const desktopRuntime = (): DesktopRuntime => {
  if (typeof window === "undefined") return "browser";
  if (window.mediagoDesktop?.isElectron) return "electron";
  if ("__TAURI_INTERNALS__" in window) return "tauri";
  return "browser";
};

export const isDesktopRuntime = () => desktopRuntime() !== "browser";
export const isElectronRuntime = () => desktopRuntime() === "electron";
export const isTauriRuntime = () => desktopRuntime() === "tauri";
```

**Step 3: Add desktop actions**

Create `apps/workspace/src/shared/desktop/actions.ts` with Electron first and Tauri fallback:

```ts
import { desktopRuntime } from "@/shared/desktop/runtime";

export const pickDesktopDirectory = async (title: string) => {
  if (desktopRuntime() === "electron") return window.mediagoDesktop?.pickDirectory({ title }) ?? null;
  if (desktopRuntime() === "tauri") {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false, title });
    return Array.isArray(selected) ? selected[0] ?? null : selected ?? null;
  }
  return null;
};

export const openExternalUrl = async (url: string) => {
  if (desktopRuntime() === "electron") return window.mediagoDesktop?.openExternal(url);
  if (desktopRuntime() === "tauri") {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

export const openNativePath = async (path: string) => {
  if (desktopRuntime() === "electron") return window.mediagoDesktop?.openPath(path);
  if (desktopRuntime() === "tauri") {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    return openPath(path);
  }
  throw new Error("当前运行环境不支持打开本地文件夹。");
};

export const revealNativePath = async (path: string) => {
  if (desktopRuntime() === "electron") return window.mediagoDesktop?.revealPath(path);
  if (desktopRuntime() === "tauri") {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    return revealItemInDir(path);
  }
  throw new Error("当前运行环境不支持打开本地文件夹。");
};

export const showDesktopNotification = async (title: string, body: string) => {
  if (desktopRuntime() === "electron") {
    return Boolean(await window.mediagoDesktop?.showNotification({ title, body }));
  }
  if (desktopRuntime() === "tauri") {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");
    const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    if (!granted) return false;
    sendNotification({ title, body, autoCancel: true });
    return true;
  }
  return false;
};
```

**Step 4: Test runtime detection**

Create `apps/workspace/src/shared/desktop/runtime.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { desktopRuntime } from "@/shared/desktop/runtime";

afterEach(() => {
  delete window.mediagoDesktop;
  delete window.__TAURI_INTERNALS__;
});

describe("desktopRuntime", () => {
  it("detects browser", () => {
    expect(desktopRuntime()).toBe("browser");
  });

  it("detects electron", () => {
    window.mediagoDesktop = { isElectron: true } as typeof window.mediagoDesktop;
    expect(desktopRuntime()).toBe("electron");
  });

  it("detects tauri", () => {
    window.__TAURI_INTERNALS__ = {};
    expect(desktopRuntime()).toBe("tauri");
  });
});
```

**Step 5: Verify**

Run:

```bash
pnpm -C apps/workspace test -- src/shared/desktop/runtime.test.ts
pnpm -C apps/workspace build
```

Expected: tests and typecheck pass.

**Step 6: Commit**

```bash
git add apps/workspace/src/shared/desktop
git add apps/workspace/src/vite-env.d.ts apps/workspace/src/types/desktop.d.ts
git commit -m "feat(workspace): add desktop runtime adapter"
```

Only stage whichever declaration file exists.

---

### Task 8: Replace Direct Tauri Calls In Renderer

**Files:**
- Modify: `apps/workspace/src/shared/lib/api-base.ts`
- Modify: `apps/workspace/src/main.tsx`
- Modify: `apps/workspace/src/domains/projects/lib/project-directory.ts`
- Modify: `apps/workspace/src/domains/workspace/components/directory/file-manager.ts`
- Modify: `apps/workspace/src/domains/workspace/lib/tauri-window-drag.ts`
- Modify: `apps/workspace/src/domains/agent/lib/permission-notifications.ts`
- Modify: `apps/workspace/src/domains/generation/lib/generation-notifications.ts`
- Modify: `apps/workspace/src/domains/generation/components/generatedResultActions.ts`
- Modify direct `openUrl` imports in:
  - `apps/workspace/src/pages/Settings.tsx`
  - `apps/workspace/src/domains/generation/components/GenerationWorkspace.tsx`
  - `apps/workspace/src/domains/generation/components/MediaGenerationWorkspace.tsx`
  - `apps/workspace/src/domains/workspace/components/ProjectNavigatorPanels.tsx`
- Update related tests that mock `@tauri-apps/*`

**Step 1: Update API base runtime check**

Change `apps/workspace/src/shared/lib/api-base.ts`:

```ts
import { isDesktopRuntime } from "@/shared/desktop/runtime";

export const isTauriRuntime = isDesktopRuntime;
export const apiOrigin = () => (isDesktopRuntime() ? localServerOrigin() : "");
```

Later rename `isTauriRuntime` to `isDesktopRuntime` once all call sites are clean. Keep export compatibility during migration.

**Step 2: Update root HTML classes**

Change `apps/workspace/src/main.tsx` to set:

```ts
import { desktopRuntime } from "@/shared/desktop/runtime";

const runtime = desktopRuntime();
const isDesktop = runtime !== "browser";
const isMacLikePlatform =
  window.mediagoDesktop?.platform === "darwin" ||
  navigator.userAgent.toLowerCase().includes("mac");

document.documentElement.classList.toggle("is-desktop", isDesktop);
document.documentElement.classList.toggle("is-tauri", runtime === "tauri");
document.documentElement.classList.toggle("is-electron", runtime === "electron");
document.documentElement.classList.toggle("is-tauri-macos", isDesktop && isMacLikePlatform);
```

Keep `is-tauri-macos` temporarily so existing CSS still works.

**Step 3: Replace project directory APIs**

Use `pickDesktopDirectory`, `revealNativePath`, and `openNativePath` from `@/shared/desktop/actions`.

Expected behavior:
- Electron/Tauri: native directory picker and reveal/open path.
- Browser: prompt fallback for picking; open path throws existing user-facing error.

**Step 4: Replace notifications**

Use `showDesktopNotification(title, body)` first, then browser Notification fallback where currently needed.

**Step 5: Replace URL opening**

Replace direct imports:

```ts
import { openExternalUrl } from "@/shared/desktop/actions";
```

Then call:

```ts
await openExternalUrl(url);
```

**Step 6: Replace window drag**

Keep the file name temporarily, but implement Electron CSS-friendly behavior:

```ts
import { desktopRuntime } from "@/shared/desktop/runtime";

export const useTauriWindowDrag = () =>
  useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!canStartDesktopWindowDrag(event)) return;
    if (desktopRuntime() === "tauri") void getCurrentWindow().startDragging();
    if (desktopRuntime() === "electron") void window.mediagoDesktop?.startWindowDrag();
  }, []);
```

Also add CSS for Electron drag regions in Task 9.

**Step 7: Verify no direct imports remain outside adapter**

Run:

```bash
rg -n "@tauri-apps|__TAURI_INTERNALS__" apps/workspace/src
```

Expected: only `src/shared/desktop/*` and tests intentionally covering Tauri fallback still match.

**Step 8: Run targeted tests**

Run:

```bash
pnpm -C apps/workspace test -- src/shared/lib/api-base.test.ts
pnpm -C apps/workspace test -- src/domains/agent/lib/permission-notifications.test.ts
pnpm -C apps/workspace test -- src/domains/generation/lib/generation-notifications.test.ts
pnpm -C apps/workspace build
```

Expected: all pass.

**Step 9: Commit**

```bash
git add apps/workspace/src
git commit -m "refactor(workspace): route native desktop calls through adapter"
```

---

### Task 9: Update Electron Window Drag Styling

**Files:**
- Modify: `apps/workspace/src/styles/index.css`
- Modify components using `data-tauri-drag-region` if needed

**Step 1: Add Electron app-region support**

Add CSS:

```css
.is-electron [data-tauri-drag-region] {
  -webkit-app-region: drag;
}

.is-electron [data-tauri-no-drag],
.is-electron button,
.is-electron a[href],
.is-electron input,
.is-electron select,
.is-electron textarea,
.is-electron summary,
.is-electron [role="button"],
.is-electron [role="link"],
.is-electron [contenteditable="true"] {
  -webkit-app-region: no-drag;
}
```

Do not rename all `tauri-` classes in this task.

**Step 2: Verify manually**

Run:

```bash
pnpm -C apps/workspace electron:dev
```

Expected:
- App opens.
- Top bar/sidebar drag regions move the window.
- Buttons, links, inputs, and editor controls remain clickable.

**Step 3: Commit**

```bash
git add apps/workspace/src/styles/index.css
git commit -m "fix(desktop): support electron window drag regions"
```

---

### Task 10: Update CORS For Electron Origins

**Files:**
- Modify: `services/server/internal/http/middleware/cors.go`
- Modify: `services/server/internal/http/middleware/cors_test.go`

**Step 1: Add test cases**

Add cases:

```go
{name: "electron file origin", origin: "file://", want: true},
{name: "electron localhost dev", origin: "http://127.0.0.1:31420", want: true},
```

If Electron packaged renderer sends `Origin: null` for `file://`, decide whether to allow `"null"` only for local desktop mode. Prefer avoiding this by loading a custom protocol if needed:

```ts
protocol.handle("app", ...)
```

If custom protocol is used, add:

```go
{name: "electron app protocol", origin: "app://localhost", want: true},
```

**Step 2: Implement narrow allowlist**

Update `isAllowedLocalOrigin`:

```go
switch parsed.Scheme {
case "http", "https", "tauri", "file", "app":
default:
  return false
}
if parsed.Scheme == "file" {
  return true
}
```

Keep host restrictions for network schemes.

**Step 3: Verify**

Run:

```bash
task -d services/server test
```

Expected: PASS.

**Step 4: Commit**

```bash
git add services/server/internal/http/middleware/cors.go services/server/internal/http/middleware/cors_test.go
git commit -m "fix(server): allow electron desktop origins"
```

---

### Task 11: Switch Root Desktop Tasks To Electron

**Files:**
- Modify: `Taskfile.yml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `apps/workspace/README.md`

**Step 1: Keep explicit Tauri aliases during transition**

Modify `Taskfile.yml`:

```yaml
  build:desktop:
    desc: Build the Electron desktop app
    cmds:
      - task: build:electron

  dev:desktop:
    desc: Run the Electron desktop app against an external dev server
    env:
      VITE_MEDIAGO_SERVER_PORT: "{{.DEV_SERVER_PORT}}"
    cmds:
      - pnpm -C apps/workspace electron:dev

  build:tauri:
    desc: Build the legacy Tauri desktop app
    cmds:
      - pnpm -C apps/workspace tauri:build

  dev:tauri:
    desc: Run the legacy Tauri desktop app
    cmds:
      - pnpm -C apps/workspace tauri:dev
```

Modify root `package.json` only if script names need clarity. Keep `dev:desktop` and `build:desktop` stable.

**Step 2: Update docs**

Replace "Tauri" descriptions with Electron where desktop commands are documented. Keep a short migration note while Tauri still exists:

```md
The desktop shell is migrating from Tauri to Electron. Use `pnpm dev:desktop` and `pnpm build:desktop`; legacy Tauri commands remain as `task dev:tauri` and `task build:tauri` until cleanup.
```

**Step 3: Verify root commands**

Run:

```bash
pnpm build:desktop
```

Expected: Electron build succeeds.

**Step 4: Commit**

```bash
git add Taskfile.yml package.json README.md apps/workspace/README.md
git commit -m "chore(desktop): switch desktop commands to electron"
```

---

### Task 12: Remove Tauri Dependencies And Rust Shell

Do this only after Electron dev/build parity is confirmed.

**Files:**
- Delete: `apps/workspace/src-tauri/`
- Delete: `apps/workspace/scripts/stage-tauri.ts`
- Modify: `apps/workspace/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/workspace/vite.config.ts`
- Modify: `Taskfile.yml`
- Modify: docs/readmes

**Step 1: Remove Tauri packages**

Run:

```bash
pnpm -C apps/workspace remove @tauri-apps/api @tauri-apps/plugin-dialog @tauri-apps/plugin-notification @tauri-apps/plugin-opener
pnpm -C apps/workspace remove -D @tauri-apps/cli
```

Expected: Tauri packages disappear from `apps/workspace/package.json` and `pnpm-lock.yaml`.

**Step 2: Remove Tauri scripts**

Delete:

```json
"dev:tauri": "...",
"tauri": "...",
"tauri:dev": "...",
"tauri:build": "..."
```

Remove Tauri-specific Vite env handling if unused:

```ts
const tauriDevHost = process.env.TAURI_DEV_HOST;
const isTauriWindows = process.env.TAURI_ENV_PLATFORM === "windows";
const isTauriDebug = Boolean(process.env.TAURI_ENV_DEBUG);
```

Replace build target with Electron/browser target:

```ts
target: "chrome120"
```

**Step 3: Move icons**

Move existing icons from `apps/workspace/src-tauri/icons` into:

```text
apps/workspace/build/icons/
```

Update `electron-builder` config paths accordingly.

**Step 4: Remove legacy adapter fallback**

Remove Tauri fallback branches from `apps/workspace/src/shared/desktop/actions.ts` and `runtime.ts`.

Run:

```bash
rg -n "tauri|Tauri|@tauri-apps|__TAURI_INTERNALS__|src-tauri" apps/workspace Taskfile.yml README.md docs
```

Expected: only historical docs or intentionally named migration plan references remain.

**Step 5: Verify full workspace gates**

Run:

```bash
pnpm -C apps/workspace lint
pnpm -C apps/workspace format
pnpm -C apps/workspace test
pnpm -C apps/workspace build
task -d services/server test
task build:electron AGENT=opencode
```

Expected: all pass.

**Step 6: Commit**

```bash
git add Taskfile.yml README.md apps/workspace/README.md apps/workspace/package.json pnpm-lock.yaml apps/workspace/vite.config.ts apps/workspace/build apps/workspace/src
git add -u apps/workspace/src-tauri apps/workspace/scripts/stage-tauri.ts
git commit -m "chore(desktop): remove tauri shell"
```

---

### Task 13: Final Manual QA

**Files:**
- No code changes unless bugs are found.

**Step 1: Browser web app check**

Run:

```bash
pnpm dev
```

Expected:
- Browser workspace loads.
- API proxy still works.
- Browser fallbacks for directory selection and notifications still behave as before.

**Step 2: Electron dev check**

Run:

```bash
task dev:server
pnpm -C apps/workspace electron:dev
```

Expected:
- Electron window opens.
- API calls hit `127.0.0.1:8080`.
- Open external URL works.
- Pick directory works.
- Reveal/open directory works.
- Notifications appear or fall back gracefully.
- Window dragging works and controls remain clickable.

**Step 3: Packaged Electron check**

Run:

```bash
task build:electron AGENT=opencode
```

Open the generated app from `apps/workspace/release`.

Expected:
- Packaged app starts without separate server.
- Go sidecar starts on `48273`.
- Agent/tool resources are found.
- Closing app stops sidecar.
- On macOS, closing the window hides it and dock activation restores it.

**Step 4: Final quality gate**

Run:

```bash
task check
task test
```

Expected: both pass.

**Step 5: Commit fixes if any**

Use small conventional commits for any QA fixes:

```bash
git add <specific-files>
git commit -m "fix(desktop): <specific electron qa fix>"
```

---

## Risk Register

- **Packaged resource paths:** Electron `process.resourcesPath` differs from Tauri `BaseDirectory::Resource`. Verify agent/tool discovery in packaged app, not only dev.
- **Sidecar config path:** Current Tauri sidecar may rely on embedded server assets or cwd behavior. Electron `spawn` may need explicit `cwd` and bundled config files.
- **CORS with file origins:** Packaged Electron may produce `file://` or `Origin: null`. Prefer a custom app protocol if CORS becomes broad.
- **Window drag:** Tauri uses imperative `startDragging`; Electron prefers CSS `-webkit-app-region`. Test click targets carefully.
- **Notifications:** Electron notifications do not use browser permission flow. Existing tests should assert "shown/fallback" behavior, not exact Tauri plugin calls.
- **Binary size:** Electron will increase package size. This is expected and should be called out in release notes.

## Completion Criteria

- `pnpm dev` works for browser development.
- `pnpm -C apps/workspace electron:dev` works with external dev server.
- `task build:electron AGENT=opencode` produces a runnable packaged app.
- No production renderer code imports `@tauri-apps/*`.
- `apps/workspace/src-tauri` and Tauri packages are removed after parity.
- `task check` and `task test` pass.
