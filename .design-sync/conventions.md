## How to build with this design system

These are the shared UI components from the MediaGo Drama workspace app — a
shadcn-style kit (Radix primitives + Tailwind v4 tokens). Build real screens by
composing these components and using this system's Tailwind utility classes for
your own layout glue. Everything below is verified against the bundle.

### Setup & wrapping
- **No global provider is needed for styling.** All design tokens are plain CSS
  custom properties applied at `:root` from `styles.css` — just render components.
- **Theme:** light is the default (`:root`). Dark mode = set
  `data-theme="dark"` on `<html>` (`:root[data-theme="dark"]`). Don't toggle a
  `.dark` class — this system keys off `data-theme`.
- **Tooltip needs a provider.** Wrap tooltip usage in `<TooltipProvider>` (once,
  high in the tree) or tooltips won't open.
- **Toaster** is mounted once at the app root: render `<Toaster />` near the root,
  then call sonner's `toast(...)` from anywhere to show notifications.

### Styling idiom — Tailwind v4 with semantic tokens
Style your own layout with utility classes. NEVER hardcode hex colors — always use
these semantic color utilities (each maps to a CSS var, so it tracks theme). Note:
`styles.css` is a prebuilt stylesheet — the utilities below are confirmed present;
if you need a color the table doesn't list, prefer a CSS var (`style={{ color:
"var(--accent)" }}`) over a utility class that may not be in the sheet.

| Utility family | Real names in this system |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-popover`, `bg-muted` |
| Text | `text-foreground`, `text-muted-foreground`, `text-card-foreground`, `text-popover-foreground` |
| Brand / intent | `bg-primary` `text-primary-foreground` (brand blue), `bg-destructive` `text-destructive-foreground` |
| Borders / focus | `border-border`, `border-input`, `ring-ring` |
| IDE workbench surfaces | `bg-ide-panel`, `bg-ide-editor`, `bg-ide-toolbar`, `bg-ide-sidebar`, `bg-ide-list-hover`, `bg-ide-list-active` (and matching `*-foreground`) |
| Status surfaces | `bg-success-surface`, `bg-info-surface`, `bg-warning-surface`, `bg-error-surface` (+ `*-border`, `*-foreground`) |

Other idioms this system relies on: radii are small — default to `rounded-sm`;
elevation via `shadow-sm` / `shadow-md` / `shadow-lg`; type via `text-xs` (the UI
default), `text-sm`, `font-medium` / `font-semibold`; spacing via the normal
Tailwind scale (`gap-2`, `p-3`, `px-2`, `h-8`). Component variants are props, not
classes — e.g. `<Button variant="destructive" size="sm">`, `<Badge variant="outline">`,
`<Alert variant="destructive">`.

### Where the truth lives
- `styles.css` (and its `@import`s, incl. `_ds_bundle.css`) — the full token +
  utility stylesheet. Read it before inventing any class or color.
- Each component's `<Name>.prompt.md` (usage) and `<Name>.d.ts` (props contract).

### Idiomatic example
```tsx
<Card className="w-80">
  <CardHeader>
    <CardTitle>Render queue</CardTitle>
    <CardDescription>3 clips waiting to export.</CardDescription>
  </CardHeader>
  <CardContent className="flex items-center justify-between text-xs">
    <span className="text-muted-foreground">Status</span>
    <Badge>Rendering</Badge>
  </CardContent>
  <CardFooter>
    <Button size="sm">Open</Button>
    <Button size="sm" variant="ghost">Cancel</Button>
  </CardFooter>
</Card>
```
