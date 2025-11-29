/**
 * Example GDS file types and interfaces
 */

export type ExampleCategory = "photonics" | "digital" | "mixed" | "demo";
export type ExampleSource = "gdsfactory" | "tinytapeout" | "other";

/**
 * Configuration for an example GDS file
 */
export interface Example {
	/** Unique identifier for the example */
	id: string;
	/** Display name */
	name: string;
	/** Short description */
	description: string;
	/** Category for filtering/grouping */
	category: ExampleCategory;
	/** Source project */
	source: ExampleSource;
	/** Attribution text */
	attribution: string;
	/** License info */
	license: string;
	/** URL to the GDS file (Hugging Face preferred) */
	url: string;
	/** File size in MB */
	fileSizeMB: number;
	/** Whether the file is gzip compressed */
	isCompressed: boolean;
	/** URL to pre-generated overview preview image */
	previewOverviewUrl?: string;
	/** URL to pre-generated detail preview image */
	previewDetailUrl?: string;
	/** Embedded base64 preview (for small thumbnails) */
	previewBase64?: string;
}

/**
 * State for tracking example loading
 */
export interface ExampleLoadingState {
	isLoading: boolean;
	progress: number;
	message: string;
	exampleId: string | null;
}
