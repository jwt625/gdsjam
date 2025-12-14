/**
 * Python code example types and interfaces
 */

export type ExampleScriptCategory = "photonics" | "tutorial" | "demo";

/**
 * Configuration for an example Python script
 */
export interface ExampleScript {
	/** Unique identifier for the example */
	id: string;
	/** Display name */
	name: string;
	/** Short description */
	description: string;
	/** Category for filtering/grouping */
	category: ExampleScriptCategory;
	/** File name in the examples directory */
	fileName: string;
	/** Estimated execution time in seconds */
	executionTimeSec?: number;
	/** Approximate line count */
	lineCount?: number;
}
