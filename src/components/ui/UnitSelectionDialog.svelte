<script lang="ts">
/**
 * Unit Selection Dialog
 * Prompts user to confirm or change units when loading DXF files without unit information
 */

interface Props {
	visible: boolean;
	defaultUnit: string;
	onConfirm: (unitInMeters: number) => void;
	onCancel: () => void;
}

const { visible, defaultUnit, onConfirm, onCancel }: Props = $props();

let selectedUnit = $state(defaultUnit);

const unitOptions = [
	{ value: "0.001", label: "Millimeters (mm)", meters: 0.001 },
	{ value: "0.01", label: "Centimeters (cm)", meters: 0.01 },
	{ value: "1.0", label: "Meters (m)", meters: 1.0 },
	{ value: "0.0254", label: "Inches (in)", meters: 0.0254 },
	{ value: "0.3048", label: "Feet (ft)", meters: 0.3048 },
	{ value: "1e-6", label: "Micrometers (µm)", meters: 1e-6 },
];

function handleConfirm() {
	const selected = unitOptions.find((opt) => opt.value === selectedUnit);
	if (selected) {
		onConfirm(selected.meters);
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter") {
		handleConfirm();
	} else if (e.key === "Escape") {
		onCancel();
	}
}
</script>

{#if visible}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="dialog-overlay" role="dialog" aria-modal="true" tabindex="-1" onkeydown={handleKeydown}>
		<div class="dialog-content">
			<h2>DXF Unit Selection</h2>
			<p class="dialog-message">
				This DXF file does not specify units. Please select the correct unit for the coordinates:
			</p>

			<div class="unit-selector">
				{#each unitOptions as option}
					<label class="unit-option">
						<input
							type="radio"
							name="unit"
							value={option.value}
							bind:group={selectedUnit}
						/>
						<span>{option.label}</span>
					</label>
				{/each}
			</div>

			<div class="dialog-actions">
				<button class="btn btn-secondary" onclick={onCancel}>Cancel</button>
				<button class="btn btn-primary" onclick={handleConfirm}>Confirm</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.dialog-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
		backdrop-filter: blur(4px);
	}

	.dialog-content {
		background: #1e1e1e;
		border: 1px solid #3a3a3a;
		border-radius: 8px;
		padding: 24px;
		max-width: 500px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

	h2 {
		margin: 0 0 16px 0;
		color: #ffffff;
		font-size: 20px;
		font-weight: 600;
	}

	.dialog-message {
		margin: 0 0 20px 0;
		color: #cccccc;
		line-height: 1.5;
	}

	.unit-selector {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 24px;
	}

	.unit-option {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.unit-option:hover {
		background: #333333;
		border-color: #4a9eff;
	}

	.unit-option input[type="radio"] {
		cursor: pointer;
	}

	.unit-option span {
		color: #ffffff;
		font-size: 14px;
	}

	.dialog-actions {
		display: flex;
		gap: 12px;
		justify-content: flex-end;
	}

	.btn {
		padding: 10px 20px;
		border: none;
		border-radius: 4px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-secondary {
		background: #3a3a3a;
		color: #ffffff;
	}

	.btn-secondary:hover {
		background: #4a4a4a;
	}

	.btn-primary {
		background: #4a9eff;
		color: #ffffff;
	}

	.btn-primary:hover {
		background: #5aa9ff;
	}
</style>

