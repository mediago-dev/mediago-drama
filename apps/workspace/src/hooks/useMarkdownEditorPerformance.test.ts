import type { Editor } from "@tiptap/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMarkdownEditorPerformance } from "./useMarkdownEditorPerformance";

afterEach(() => {
	vi.useRealTimers();
});

describe("useMarkdownEditorPerformance", () => {
	it("batches editor updates and serializes only the latest value", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const onMarkdownSerialized = vi.fn();
		let markdown = "# 第一版";
		const editor = {
			getMarkdown: () => markdown,
			isDestroyed: false,
		} as unknown as Editor;
		const { result } = renderHook(() =>
			useMarkdownEditorPerformance({
				onChange,
				onMarkdownSerialized,
				value: "",
			}),
		);

		act(() => {
			result.current.handleUpdate(editor);
			markdown = "# 最终版本";
			result.current.handleUpdate(editor);
			vi.advanceTimersByTime(159);
		});
		expect(onChange).not.toHaveBeenCalled();

		act(() => vi.advanceTimersByTime(1));
		expect(onChange).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalledWith("# 最终版本");
		expect(onMarkdownSerialized).toHaveBeenCalledWith("# 最终版本", editor);
	});

	it("flushes pending content immediately on blur", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const editor = {
			getMarkdown: () => "立即保存",
			isDestroyed: false,
		} as unknown as Editor;
		const { result } = renderHook(() => useMarkdownEditorPerformance({ onChange, value: "" }));

		act(() => {
			result.current.handleUpdate(editor);
			result.current.handleBlur();
		});

		expect(onChange).toHaveBeenCalledWith("立即保存");
		expect(result.current.hasPendingMarkdownChange()).toBe(false);
	});

	it("keeps writing-specific suppression optional", () => {
		vi.useFakeTimers();
		const onChange = vi.fn();
		const editor = {
			getMarkdown: () => "流式内容",
			isDestroyed: false,
		} as unknown as Editor;
		const { result } = renderHook(() =>
			useMarkdownEditorPerformance({
				isChangeSuppressed: () => true,
				onChange,
				value: "",
			}),
		);

		act(() => {
			result.current.handleUpdate(editor);
			vi.advanceTimersByTime(160);
		});

		expect(onChange).not.toHaveBeenCalled();
	});
});
