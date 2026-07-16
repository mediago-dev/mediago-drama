# Agent Floating Plan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the active ACP plan as an expandable floating card above the agent composer while retaining the existing inline plan in completed turn history.

**Architecture:** Derive the latest structured plan from the active conversation messages in the frontend. Render a dedicated presentational component between the timeline and composer only while a run is active; the existing `PlanBlock` remains the durable historical representation.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, lucide-react, Vitest, Testing Library

---

### Task 1: Define live-plan selection behavior

**Files:**
- Create: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.test.tsx`
- Create: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.tsx`

**Step 1: Write failing tests**

Cover selection of the latest structured plan, omission when no plan exists, current-step calculation, expansion, collapse, and accessible labels.

**Step 2: Run the focused test**

Run: `pnpm --dir apps/workspace test -- src/domains/agent/components/chat/AgentLivePlan.test.tsx`

Expected: FAIL because `AgentLivePlan` does not exist.

### Task 2: Implement the floating plan card

**Files:**
- Create: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.tsx`
- Modify: `apps/workspace/src/domains/agent/components/timeline/PlanBlock.tsx`
- Modify: `apps/workspace/src/styles/index.css`

**Step 1: Implement minimal state derivation**

Find the last message with `kind: "plan"` and non-empty `metadata.planEntries`. Derive the current step as the in-progress entry, then the first pending entry, then the final entry for a completed plan.

**Step 2: Implement accessible interaction**

Render an expanded step card and a pill-shaped button labelled `第 N / M 步`. The button controls a labelled region with `aria-expanded` and `aria-controls`.

**Step 3: Style with project tokens**

Use existing agent variables and semantic tokens for surface, border, text, success, warning, error, radius, and shadows. Add responsive width and reduced-motion behavior.

**Step 4: Run the focused test**

Run: `pnpm --dir apps/workspace test -- src/domains/agent/components/chat/AgentLivePlan.test.tsx`

Expected: PASS.

### Task 3: Integrate into the agent chat shell

**Files:**
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.tsx`
- Modify: `apps/workspace/src/domains/agent/components/AgentChat.test.tsx`

**Step 1: Write the integration test**

Assert the live-plan slot is rendered between the timeline and composer and receives active messages only while the run is active.

**Step 2: Implement the integration**

Render `AgentLivePlan` after permission requests and before `AgentChatComposerForm`, passing the current messages and `isRunning`.

**Step 3: Run agent chat tests**

Run: `pnpm --dir apps/workspace test -- src/domains/agent/components/AgentChat.test.tsx`

Expected: PASS.

### Task 4: Verify behavior and quality gates

**Files:**
- Test: `apps/workspace/src/domains/agent/components/chat/AgentLivePlan.test.tsx`
- Test: `apps/workspace/src/domains/agent/components/AgentTimeline.test.tsx`
- Test: `apps/workspace/src/domains/agent/components/AgentChat.test.tsx`

**Step 1: Run targeted regression tests**

Run: `pnpm --dir apps/workspace test -- src/domains/agent/components/chat/AgentLivePlan.test.tsx src/domains/agent/components/AgentChat.test.tsx src/domains/agent/components/AgentTimeline.test.tsx`

Expected: PASS.

**Step 2: Run workspace quality gates**

Run: `pnpm --dir apps/workspace lint`, `pnpm --dir apps/workspace format`, and `pnpm --dir apps/workspace build`.

Expected: all commands exit 0.

**Step 3: Inspect the running UI**

Open the agent workspace, trigger a multi-step ACP plan, and verify expanded, collapsed, current-step, completed-step, dark-theme, and narrow-width presentation.

No commit is included because the current worktree already contains unrelated and overlapping user changes.
