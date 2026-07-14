# Credential Row Actions Design

## Intent

Credential rows should emphasize their primary action—login or edit—without showing a destructive trash icon on every row. Each row gets a right-aligned ellipsis button that opens a compact action menu. OAuth providers expose “退出登录” when configured and “取消登录” while an authorization challenge is pending. API-key providers expose “清除 API Key”. Unavailable actions remain disabled so every row keeps a consistent layout without implying that an unconfigured credential can be deleted.

## Interaction

Selecting a destructive menu item closes the menu and opens the shared confirmation dialog. The dialog names the provider and explains the consequence. Cancellation performs no request. Confirmation calls the existing credential-clear endpoint, keeps the dialog open while the request runs, and closes only after success; errors continue to use the existing toast and leave the dialog available for retry.

The ellipsis trigger has a provider-specific accessible label, the popover is keyboard reachable, and the destructive item uses semantic destructive colors. Existing login, authorization confirmation, and edit controls remain unchanged. The same confirmation wrapper also applies to clear actions inside credential configuration dialogs so clearing is never immediate.

## Verification

Regression tests cover menu visibility, OAuth/API-key copy, disabled empty states, cancellation, confirmation, and the interrupted Jimeng login recovery path. The page must continue to pass the workspace lint, formatting, test, and production-build gates.
