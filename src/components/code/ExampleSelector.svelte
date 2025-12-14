<script lang="ts">
/**
 * ExampleSelector - Minimal dropdown for selecting example scripts
 *
 * Features:
 * - Shows current example name, expands on click
 * - Minimal space usage
 * - Instant transitions (no animations)
 * - Click outside to close
 */

import { EXAMPLE_SCRIPTS, getExampleScriptById } from "../../lib/code/exampleScripts";
import type { ExampleScript } from "../../lib/code/types";

interface Props {
	currentExampleId: string | null;
	onSelect: (example: ExampleScript) => void;
}

const { currentExampleId, onSelect }: Props = $props();

let isOpen = $state(false);
let dropdownElement: HTMLDivElement;

// Get current example display name
const currentExample = $derived(currentExampleId ? getExampleScriptById(currentExampleId) : null);
const displayName = $derived(currentExample?.name || "Select Example");

function toggleDropdown() {
	isOpen = !isOpen;
}

function handleSelect(example: ExampleScript) {
	onSelect(example);
	isOpen = false;
}

// Close dropdown when clicking outside
function handleClickOutside(event: MouseEvent) {
	if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
		isOpen = false;
	}
}

$effect(() => {
	if (isOpen) {
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}
});
</script>

<div class="example-selector" bind:this={dropdownElement}>
	<button class="selector-button" onclick={toggleDropdown} type="button" title="Select example script">
		<span class="example-name">{displayName}</span>
		<span class="dropdown-arrow">{isOpen ? "▲" : "▼"}</span>
	</button>

	{#if isOpen}
		<div class="dropdown-menu">
			{#each EXAMPLE_SCRIPTS as example (example.id)}
				<button
					class="dropdown-item"
					class:active={currentExampleId === example.id}
					onclick={() => handleSelect(example)}
					type="button"
				>
					<div class="item-header">
						<span class="item-name">{example.name}</span>
						{#if currentExampleId === example.id}
							<span class="checkmark">✓</span>
						{/if}
					</div>
					<div class="item-description">{example.description}</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
.example-selector {
	position: relative;
	display: inline-block;
}

.selector-button {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 8px;
	background: transparent;
	border: 1px solid #3e3e42;
	border-radius: 3px;
	color: #d4d4d4;
	font-size: 13px;
	cursor: pointer;
	transition: background-color 0.1s;
}

.selector-button:hover {
	background: #2a2d2e;
	border-color: #4e4e52;
}

.example-name {
	max-width: 200px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.dropdown-arrow {
	font-size: 10px;
	color: #858585;
}

.dropdown-menu {
	position: absolute;
	top: calc(100% + 4px);
	left: 0;
	min-width: 350px;
	max-width: 500px;
	background: #252526;
	border: 1px solid #3e3e42;
	border-radius: 3px;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
	z-index: 1000;
	max-height: 400px;
	overflow-y: auto;
}

.dropdown-item {
	width: 100%;
	padding: 10px 12px;
	background: transparent;
	border: none;
	border-bottom: 1px solid #2a2d2e;
	text-align: left;
	cursor: pointer;
	transition: background-color 0.1s;
}

.dropdown-item:last-child {
	border-bottom: none;
}

.dropdown-item:hover {
	background: #2a2d2e;
}

.dropdown-item.active {
	background: #094771;
}

.item-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 4px;
}

.item-name {
	font-size: 13px;
	font-weight: 500;
	color: #d4d4d4;
}

.checkmark {
	color: #4ec9b0;
	font-size: 14px;
}

.item-description {
	font-size: 12px;
	color: #858585;
	line-height: 1.4;
}
</style>

