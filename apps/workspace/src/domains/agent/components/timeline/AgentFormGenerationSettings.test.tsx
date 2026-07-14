import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationSettingsValue } from "@/domains/generation/components/generationSettingsValue";
import { AgentFormGenerationSettings } from "./AgentFormGenerationSettings";

const mocks = vi.hoisted(() => ({
	controller: {} as Record<string, unknown>,
	form: vi.fn(),
	useGenerationSettingsForm: vi.fn(),
}));

vi.mock("@/domains/generation/hooks/useGenerationSettingsForm", () => ({
	useGenerationSettingsForm: (...args: unknown[]) => mocks.useGenerationSettingsForm(...args),
}));

vi.mock("@/domains/generation/components/GenerationSettingsForm", () => ({
	GenerationSettingsForm: (props: { disabled?: boolean }) => {
		mocks.form(props);
		return <div data-testid="shared-generation-settings-form" data-disabled={props.disabled} />;
	},
}));

const value: GenerationSettingsValue = {
	kind: "image",
	label: "Seedream 5",
	params: { n: 1, ratio: "3:4", resolution: "2k" },
	promptOptimization: { enabled: false },
	promptSupplements: [],
	referenceAssetIds: ["asset-a"],
	routeId: "route-image",
};

describe("AgentFormGenerationSettings", () => {
	beforeEach(() => {
		mocks.controller = {
			isBusy: false,
			isReady: true,
			isUploadingReference: false,
			isValid: true,
			value,
		};
		mocks.form.mockClear();
		mocks.useGenerationSettingsForm.mockClear();
		mocks.useGenerationSettingsForm.mockImplementation(() => mocks.controller);
	});
	afterEach(cleanup);

	it("is a thin shared-form adapter and emits the complete canonical value", async () => {
		const onBusyChange = vi.fn();
		const onChange = vi.fn();
		const onValidityChange = vi.fn();
		const defaultValue = { routeId: "agent-default-route" };

		render(
			<AgentFormGenerationSettings
				defaultValue={defaultValue}
				disabled={false}
				fieldId="settings"
				onBusyChange={onBusyChange}
				onChange={onChange}
				onValidityChange={onValidityChange}
				projectId="project-a"
				selectionId="selection-a"
			/>,
		);

		expect(screen.getByTestId("shared-generation-settings-form")).toBeTruthy();
		expect(mocks.form).toHaveBeenLastCalledWith(
			expect.objectContaining({ controller: mocks.controller, disabled: false }),
		);
		const options = mocks.useGenerationSettingsForm.mock.calls[0]?.[0];
		expect(options).toEqual(
			expect.objectContaining({
				defaultValue,
				kind: "image",
				persist: true,
				projectId: "project-a",
				uploadIdPrefix: "agent-generation-settings-selection-a-settings",
			}),
		);

		await waitFor(() => expect(onChange).toHaveBeenCalledWith(value));
		await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
		expect(onValidityChange).toHaveBeenLastCalledWith(true);
	});

	it("reports hydration and validity separately from an actual upload", async () => {
		mocks.controller = {
			...mocks.controller,
			isBusy: true,
			isReady: false,
			isUploadingReference: false,
			isValid: false,
		};
		const onBusyChange = vi.fn();
		const onChange = vi.fn();
		const onValidityChange = vi.fn();
		const props = {
			disabled: false,
			fieldId: "settings",
			onBusyChange,
			onChange,
			onValidityChange,
			selectionId: "selection-a",
		};
		const { rerender } = render(<AgentFormGenerationSettings {...props} />);

		await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
		expect(onValidityChange).toHaveBeenLastCalledWith(false);
		expect(onChange).not.toHaveBeenCalled();

		mocks.controller = {
			...mocks.controller,
			isBusy: true,
			isReady: true,
			isUploadingReference: true,
			isValid: true,
		};
		rerender(<AgentFormGenerationSettings {...props} />);

		await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
		expect(onValidityChange).toHaveBeenLastCalledWith(true);
		expect(onChange).toHaveBeenLastCalledWith(value);
	});

	it("uses a distinct reference upload id for each selection field", () => {
		const common = { disabled: false, onChange: vi.fn() };
		render(
			<>
				<AgentFormGenerationSettings {...common} fieldId="settings-a" selectionId="selection-a" />
				<AgentFormGenerationSettings {...common} fieldId="settings-b" selectionId="selection-b" />
			</>,
		);
		const prefixes = mocks.useGenerationSettingsForm.mock.calls.map(
			([options]) => (options as { uploadIdPrefix: string }).uploadIdPrefix,
		);
		expect(prefixes).toEqual([
			"agent-generation-settings-selection-a-settings-a",
			"agent-generation-settings-selection-b-settings-b",
		]);
	});
});
