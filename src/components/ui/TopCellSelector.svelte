<script lang="ts">
import type { LayoutSceneIndex, TopCellSelection } from "../../lib/layout/LayoutSceneIndex";

interface Props {
	index: LayoutSceneIndex;
	selection: TopCellSelection;
	onSelect: (cellName: string) => void;
	onShowAll: () => void;
}

const { index, selection, onSelect, onShowAll }: Props = $props();
const value = $derived(
	selection.mode === "single" ? selection.cellName : selection.mode === "all" ? "__all__" : "",
);

function handleChange(event: Event): void {
	const next = (event.currentTarget as HTMLSelectElement).value;
	if (next === "__all__") onShowAll();
	else if (next) onSelect(next);
}
</script>

{#if index.topCells.length > 1}
	<section
		class:selection-required={selection.mode === "required"}
		class="top-cell-selector"
		aria-labelledby="top-cell-title"
		data-testid="top-cell-selector"
	>
		<div class="copy">
			<strong id="top-cell-title">Choose a top cell</strong>
			{#if selection.mode === "required"}
				<p>Select one top-level cell to render, or explicitly show the aggregate layout.</p>
			{/if}
		</div>
		<label>
			<span class="sr-only">Top cell render scope</span>
			<select value={value} onchange={handleChange} aria-required={selection.mode === "required"}>
				<option value="" disabled>Select a top cell…</option>
				{#each index.topCells as cellName}
					<option value={cellName}>{cellName}</option>
				{/each}
				<option value="__all__">Show all top cells</option>
			</select>
		</label>
	</section>
{/if}

<style>
	.top-cell-selector {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 44;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: min(34rem, calc(100% - 1.5rem));
		border: 1px solid #475569;
		background: rgb(15 23 42 / 94%);
		color: #f8fafc;
		padding: 0.55rem 0.65rem;
		box-shadow: 0 4px 14px rgb(0 0 0 / 35%);
		font-size: 0.8rem;
	}

	.top-cell-selector.selection-required {
		top: 50%;
		left: 50%;
		z-index: 46;
		width: min(32rem, calc(100% - 2rem));
		transform: translate(-50%, -50%);
		flex-direction: column;
		align-items: stretch;
		border-color: #60a5fa;
		padding: 1rem;
	}

	.copy {
		min-width: 0;
	}

	strong {
		display: block;
		font-size: 0.9rem;
	}

	p {
		margin: 0.35rem 0 0;
		color: #cbd5e1;
		line-height: 1.35;
	}

	select {
		width: 100%;
		min-width: 12rem;
		border: 1px solid #64748b;
		border-radius: 0;
		background: #0f172a;
		color: #f8fafc;
		padding: 0.45rem 0.55rem;
		font: inherit;
	}

	select:focus-visible {
		outline: 2px solid #60a5fa;
		outline-offset: 2px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 640px) {
		.top-cell-selector:not(.selection-required) {
			right: 0.75rem;
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
