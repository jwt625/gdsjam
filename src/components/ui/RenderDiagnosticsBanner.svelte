<script lang="ts">
import type { RenderDiagnostics } from "../../lib/diagnostics/renderDiagnostics";

interface Props {
	diagnostics: RenderDiagnostics;
}

const { diagnostics }: Props = $props();
</script>

{#if diagnostics.status !== "pending" && diagnostics.status !== "complete" && diagnostics.status !== "failed"}
	<details class="render-warning" open>
		<summary>Layout is partially rendered</summary>
		<p>Some geometry may be missing from this view.</p>
		<ul>
			{#each diagnostics.issues as issue}
				<li>{issue.message}{issue.count && issue.count > 1 ? ` (${issue.count})` : ""}</li>
			{/each}
		</ul>
	</details>
{/if}

<style>
	.render-warning {
		position: absolute;
		top: 0.75rem;
		left: 50%;
		z-index: 45;
		max-width: min(34rem, calc(100% - 2rem));
		transform: translateX(-50%);
		border: 1px solid #f59e0b;
		border-radius: 0;
		background: rgb(69 39 7 / 94%);
		color: #fef3c7;
		padding: 0.55rem 0.75rem;
		box-shadow: 0 4px 14px rgb(0 0 0 / 35%);
		font-size: 0.8rem;
	}

	summary {
		cursor: pointer;
		font-weight: 650;
	}

	p {
		margin: 0.35rem 0 0;
	}

	ul {
		margin: 0.35rem 0 0;
		padding-left: 1.2rem;
	}
</style>
