# design-sync notes — mediago-drama / apps/workspace UI

Repo-specific gotchas for re-syncs. The design system synced is the shadcn-style
UI kit in `apps/workspace/src/shared/components/ui/` (15 components).

## Source shape & entry
- `apps/workspace` is a Tauri **app** (`react-spa-template`, private), NOT a published
  library. There is no `module`/`main`/`exports` library entry, so the converter runs
  in **synth-entry mode** via a curated entry: `apps/workspace/.design-sync-entry.ts`
  (re-exports the 15 ui modules). `cfg.entry` points at it; `--entry` makes PKG_DIR
  walk up to `apps/workspace/package.json`.
- The 15 components are pinned explicitly in `cfg.componentSrcMap`. Do NOT rely on
  src-derivation — without the pins the synth path would scan the whole app (hundreds
  of page/domain components). Add a new ui component to BOTH the entry file and
  `componentSrcMap`.
- `window.MediagoUI` carries 62 exports (all sub-parts: CardHeader, SelectTrigger,
  AlertDialogContent, etc.) so previews can compose compounds. Only the 15 top-level
  names get component cards.

## tsconfig / path aliases  (IMPORTANT gotcha)
- The converter's tsconfig comment-stripper mis-parses path globs: a `"@/*"` key
  contains `/*`, which its block-comment regex treats as a comment opener and eats the
  whole `paths` block → `@/` fails to resolve. So we DON'T point `cfg.tsconfig` at the
  real `tsconfig.app.json` (which also has `/* ... */` comments). Instead we ship a
  dedicated **comment-free** `apps/workspace/tsconfig.designsync.json` with just
  `baseUrl` + `paths`. Keep its paths in sync with `tsconfig.app.json` if aliases change.

## CSS  (Tailwind v4)
- Components style via Tailwind v4 utility classes; utilities only exist after Tailwind
  compiles by scanning source. So `cfg.cssEntry` = the **built app stylesheet**, copied
  to a stable path `apps/workspace/dist/ds-styles.css` (a superset containing every
  utility + all tokens; ~202KB). The brand semantic theme is BLUE (`--primary:
  rgb(77 137 255)`); the orange `--color-primary-*` scale is just a palette, not the
  default theme. Light theme = `:root`; dark = `:root[data-theme="dark"]` (previews
  render light by default — correct).
- **Re-sync rebuild**: `dist/` is gitignored, so on a fresh clone the CSS copy is
  absent. `cfg.buildCmd` rebuilds the app AND re-copies the newest hashed CSS to
  `dist/ds-styles.css`. Run it (or at least the copy) before the converter when the app
  source changed.

## Previews authored / floor cards
- Authored + graded good (14): Button, Card, Alert, Badge, Input, Label, Textarea, Tabs,
  Tooltip, Popover, AlertDialog, Sheet, Select, Toaster.
- Overlays render their open state via `defaultOpen` + `cfg.overrides.<Name>` (cardMode
  single + viewport): Tooltip, Popover, AlertDialog, Sheet. Tabs uses `cardMode: column`
  (its tab rows overflow a grid cell). Select is shown CLOSED (trigger + value) — the
  open dropdown portals unreliably in static capture; the trigger is the honest render.
- **Toaster** is driven by exposing sonner's imperative `toast` on the bundle: the
  curated entry (`apps/workspace/.design-sync-entry.ts`) does `export { toast } from
  "sonner"`, so `window.MediagoUI.toast` shares the SAME bundled sonner instance as the
  Toaster component. The preview (`previews/Toaster.tsx`) fires two `duration: Infinity`
  toasts on mount so the static capture catches them. If sonner is upgraded, re-verify
  this still renders.
- **Floor card (1), by design:** `ContextMenu` — Radix context menu opens only on
  right-click; its Root has no `defaultOpen`/`open`, so the menu can't be shown in a
  static preview. Fully functional; the floor card is the honest baseline. Standing offer
  for future authoring.
- `[TOKENS_MISSING]` ~41 vars (`--generation-history-*`, `--media-*`, `--overlay-*`,
  `--cue-*`, etc.): these are media-player / generation-workspace runtime vars present
  in the full-app CSS but NOT used by any of the 15 ui components, and they're set at
  runtime via inline style/JS. Expected absent; non-blocking. (Cost of shipping the
  whole-app stylesheet as cssEntry — accepted for correctness/superset coverage.)
- Fonts: the repo ships **no font files**. The sans stack starts with brand
  "MILan Pro VF" then system CJK/latin fallbacks (PingFang SC, Avenir Next, …); mono is
  SF Mono/Monaco/Inconsolata/etc. None are bundled — all host/system-provided. Suppressed
  via `cfg.runtimeFontPrefixes`. Designs render in system fonts; this is intended.

## Re-sync risks
- `cfg.cssEntry` = full-app build output. If the app adds heavy new global CSS, the
  TOKENS_MISSING list will grow (still non-blocking). A scoped Tailwind build would be
  cleaner but isn't set up (no @tailwindcss/cli installed) — full CSS is the deliberate
  choice.
- The stable CSS copy depends on `buildCmd`'s `ls -t … index-*.css` picking the right
  file; if vite changes output naming, update `buildCmd`.
- Brand font "MILan Pro VF" is never shipped — if brand-accurate type matters in the DS
  pane, source the woff2 and wire `cfg.extraFonts` (and drop "MILan" from runtimeFontPrefixes).
