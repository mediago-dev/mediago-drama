# Strengthen Second-Level Heading Rules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the immutable system instructions clearly require second-level headings for storyboard resource recognition and define a safe agent repair behavior.

**Architecture:** Extend the non-editable, injectable `DOCUMENT_RULES` instruction because heading recognition is a software contract rather than editable creative guidance. Lock the contract with a focused Go test that reads the packaged official instruction and checks the required guidance remains present.

**Tech Stack:** Markdown instruction assets, Go standard library tests.

---

### Task 1: Strengthen the immutable heading contract

**Files:**
- Modify: `packages/instructions/pkg/official/official_test.go`
- Modify: `packages/instructions/pkg/official/assets/instructions/DOCUMENT_RULES.md`

**Step 1: Write the failing test**

Extend `TestDocumentRulesInstructionDefinesSecondLevelResourceBoundary` to require language covering functional recognition, post-write verification, and content-preserving repair.

**Step 2: Run the focused test to verify it fails**

Run: `go test ./pkg/official -run TestDocumentRulesInstructionDefinesSecondLevelResourceBoundary`

Expected: FAIL because the new system-rule fragments do not exist yet.

**Step 3: Write the minimal instruction change**

Update the immutable `DOCUMENT_RULES` body to explain that missing `##` headings prevents resource recognition, require a final heading check after creating or editing a business document, and instruct heading-repair requests to preserve body content, ordering, and existing `section-id` values.

**Step 4: Run focused and package tests**

Run: `go test ./pkg/official`

Run: `go test ./...`

Expected: PASS.
