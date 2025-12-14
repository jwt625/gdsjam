/**
 * Example Python scripts for the code editor
 *
 * Scripts are stored in src/components/code/examples/ and loaded using Vite's ?raw import
 */

import defaultExample from "../../components/code/examples/default.py?raw";
import picComponentShowcase from "../../components/code/examples/pic_component_showcase.py?raw";
import type { ExampleScript } from "./types";

/**
 * Map of example IDs to their content
 */
const EXAMPLE_CONTENT_MAP: Record<string, string> = {
	"tunable-optical-processor": defaultExample,
	"pic-component-showcase": picComponentShowcase,
};

/**
 * Curated list of example Python scripts
 */
export const EXAMPLE_SCRIPTS: ExampleScript[] = [
	{
		id: "tunable-optical-processor",
		name: "Tunable Optical Processor",
		description:
			"Complex PIC with 3 spiral delay lines, MZIs, heaters, and electrical routing (786 lines)",
		category: "photonics",
		fileName: "default.py",
		executionTimeSec: 3,
		lineCount: 786,
	},
	{
		id: "pic-component-showcase",
		name: "PIC Component Showcase",
		description:
			"Comprehensive showcase of 31 photonic components organized in a grid layout (380 lines)",
		category: "tutorial",
		fileName: "pic_component_showcase.py",
		executionTimeSec: 2,
		lineCount: 380,
	},
];

/**
 * Get examples filtered by category
 */
export function getExampleScriptsByCategory(category: ExampleScript["category"]): ExampleScript[] {
	return EXAMPLE_SCRIPTS.filter((e) => e.category === category);
}

/**
 * Get an example by ID
 */
export function getExampleScriptById(id: string): ExampleScript | undefined {
	return EXAMPLE_SCRIPTS.find((e) => e.id === id);
}

/**
 * Get an example by file name
 */
export function getExampleScriptByFileName(fileName: string): ExampleScript | undefined {
	return EXAMPLE_SCRIPTS.find((e) => e.fileName === fileName);
}

/**
 * Load example script content by ID
 */
export function loadExampleScript(id: string): string {
	const content = EXAMPLE_CONTENT_MAP[id];
	if (!content) {
		throw new Error(`Example script not found: ${id}`);
	}
	return content;
}
