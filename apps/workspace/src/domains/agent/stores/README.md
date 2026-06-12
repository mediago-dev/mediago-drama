# Agent Store

The agent domain uses one Zustand store with concern-based action modules.

## Layout

```text
stores/
├── store.ts              # createStore wiring and initial state
├── selectors.ts          # public selector functions for components
├── action-types.ts       # shared action/context types
├── actions.ts            # action slice composition
├── activity-actions.ts   # trace, tool, plan, runtime activity actions
├── lifecycle-actions.ts  # panel/session/run lifecycle actions
├── conversation.ts       # conversation state helpers
├── runtime-log.ts        # runtime log message helpers
├── tool-metadata.ts      # tool call message helpers
└── types.ts              # state and record types
```

## Conventions

- Components import `useAgentStore` and selectors from `@/domains/agent/stores`.
- Components should prefer named selectors from `selectors.ts` instead of inline
  `(state) => state.foo` access. This keeps state shape changes local to the
  store package.
- New actions belong in the smallest concern file that owns the behavior. Add
  the public method to `action-types.ts`, implement it in the concern module,
  then compose it through `actions.ts`.
- Shared state transforms that do not call `set` stay in helper files such as
  `conversation.ts`, `runtime-log.ts`, or `tool-metadata.ts`.
- Keep `store.ts` as wiring only: initial state plus `createAgentActions`.
