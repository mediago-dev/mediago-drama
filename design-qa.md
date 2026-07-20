# Codex Channel Switcher Design QA

- Source visual truth: `/var/folders/82/pnqvm4gn3rx4hkwvpj3861300000gn/T/codex-clipboard-f49f5b39-b866-4435-9f13-91261481f281.png`
- Implementation screenshot: `/Users/caorushizi/.codex/visualizations/2026/07/20/019f7f8f-05fc-7bc1-9dcf-6af3879d52f6/codex-channel-switcher-implementation.png`
- Viewport: 1280 × 720 desktop
- State: light theme; relay routing enabled; “默认中转” is the current channel; ChatGPT official account is logged in

## Full-view comparison evidence

The source and implementation were opened together for comparison. The implementation preserves the requested CC Switch interaction model inside the existing MediaGo settings shell: the routing switch stays in the header, the official Codex login is the first immutable card, relay profiles are peer cards, channel-type labels remain visible, and exactly one card carries the active treatment.

The reference shows the official-login state while the implementation capture shows an active relay. This is an intentional state difference: the active treatment is applied to “默认中转” instead of the official card. Component tests separately verify the official-current state when routing is disabled.

## Focused region comparison evidence

A separate crop was not required because the header controls, type badges, active border, card copy, URL rows, and action icons are all legible in the full 1280 × 720 capture. The add-channel dialog was also opened and visually inspected at the same viewport.

## Required fidelity surfaces

- Fonts and typography: Uses the existing MediaGo font stack and settings hierarchy. Card titles, small type badges, URLs, and supporting account text remain readable without introducing a foreign CC Switch type scale.
- Spacing and layout rhythm: Cards use a consistent compact desktop settings density, equal vertical gaps, aligned icon slots, and full-width activation targets. The result is denser than the standalone CC Switch app by design so it fits the existing product shell.
- Colors and visual tokens: All surfaces, borders, active treatment, labels, and semantic text use existing design tokens. No hard-coded palette was introduced.
- Image quality and asset fidelity: The official channel uses the packaged OpenAI icon asset. Relay channels use the existing icon library; no handcrafted SVG, CSS drawing, or placeholder asset is present.
- Copy and content: “Codex 登录”, “需要路由”, “当前渠道”, “路由已开启”, and “新增中转” clearly separate access type, routing state, and the active channel.

## Findings

No actionable P0, P1, or P2 differences remain. The implementation intentionally adopts the existing MediaGo density, radius, typography, and navigation chrome instead of copying CC Switch’s standalone application chrome.

## Primary interactions tested

- Opened the Codex access settings screen in the app browser.
- Verified the current relay card, official-login card, route switch, and relay actions render together.
- Opened and closed the add-relay dialog without persisting a new profile.
- Verified the unified name, Base URL, and API Key editor, including replacement and clearing behavior, through component tests.
- Verified card activation, route rollback, connectivity checks, add, and delete behavior through component tests.
- Checked browser console warnings and errors; none were reported for this screen.

## Comparison history

- Initial comparison: no P0/P1/P2 issues found. No visual fix iteration was required.

## Follow-up polish

- P3: Provider-specific relay icons could be introduced later if relay metadata gains a reliable provider identifier.

final result: passed
