/**
 * Example GDS files for the front page
 *
 * Files are hosted on Hugging Face for better CORS support and CDN performance.
 * See EXAMPLES_README.md for attribution and license information.
 */

import type { Example } from "./types";

/**
 * Base URL for the examples dataset on Hugging Face
 */
export const EXAMPLES_BASE_URL = "https://huggingface.co/datasets/jwt625/gdsii/resolve/main";

/**
 * Base URL for preview images (served from public folder)
 */
export const PREVIEWS_BASE_URL = "/previews";

/**
 * Curated list of example GDS files
 */
export const EXAMPLES: Example[] = [
	// ============================================
	// PHOTONICS EXAMPLES (from gdsfactory/ubc)
	// ============================================
	{
		id: "grating-coupler",
		name: "Grating Coupler TE",
		description: "Fiber-to-chip grating coupler (115KB)",
		category: "photonics",
		source: "gdsfactory",
		attribution: "UBC PDK / gdsfactory",
		sourceUrl: "https://github.com/gdsfactory/ubc",
		license: "MIT",
		url: "https://raw.githubusercontent.com/gdsfactory/ubc/main/ubcpdk/gds/EBeam/ebeam_gc_te1550.gds",
		fileSizeMB: 0.115,
		isCompressed: false,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/grating-coupler.png`,
	},

	{
		id: "y-splitter",
		name: "Y-Branch Splitter",
		description: "Photonic 1x2 Y-branch splitter",
		category: "photonics",
		source: "gdsfactory",
		attribution: "UBC PDK / gdsfactory",
		sourceUrl: "https://github.com/gdsfactory/ubc",
		license: "MIT",
		url: "https://raw.githubusercontent.com/gdsfactory/ubc/main/ubcpdk/gds/EBeam/ebeam_y_1550.gds",
		fileSizeMB: 0.012,
		isCompressed: false,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/y-splitter.png`,
	},

	{
		id: "pic-example-20251213",
		name: "PIC Example",
		description: "Photonic Integrated Circuit example",
		category: "photonics",
		source: "other",
		attribution: "jwt625",
		sourceUrl: "https://huggingface.co/datasets/jwt625/gdsii",
		license: "MIT",
		url: `${EXAMPLES_BASE_URL}/PIC_example_20251213.gds`,
		fileSizeMB: 0.5,
		isCompressed: false,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/PIC_example_20251213.png`,
	},

	{
		id: "pic-component-showcase",
		name: "PIC Component Showcase",
		description: "Photonic component library showcase",
		category: "photonics",
		source: "other",
		attribution: "jwt625",
		sourceUrl: "https://huggingface.co/datasets/jwt625/gdsii",
		license: "MIT",
		url: `${EXAMPLES_BASE_URL}/pic_component_showcase.gds`,
		fileSizeMB: 0.5,
		isCompressed: false,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/PIC_component_showcase_20251214.png`,
	},

	// ============================================
	// DIGITAL EXAMPLES (from TinyTapeout)
	// ============================================
	{
		id: "tt02-fpga",
		name: "FPGA on Chip",
		description: "Tiny FPGA in silicon - TinyTapeout 02",
		category: "digital",
		source: "tinytapeout",
		attribution: "gatecat / TinyTapeout",
		sourceUrl: "https://github.com/TinyTapeout/tinytapeout-02",
		license: "Apache-2.0",
		url: "https://raw.githubusercontent.com/TinyTapeout/tinytapeout-02/tt02/gds/gatecat_fpga_top.gds.gz",
		fileSizeMB: 0.7,
		isCompressed: true,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/tt02-fpga.png`,
	},
	{
		id: "tt02-riscv",
		name: "RISC-V SERV Core",
		description: "Minimal RISC-V CPU - TinyTapeout 02",
		category: "digital",
		source: "tinytapeout",
		attribution: "gregdavill / TinyTapeout",
		sourceUrl: "https://github.com/TinyTapeout/tinytapeout-02",
		license: "Apache-2.0",
		url: "https://raw.githubusercontent.com/TinyTapeout/tinytapeout-02/tt02/gds/gregdavill_serv_top.gds.gz",
		fileSizeMB: 0.55,
		isCompressed: true,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/tt02-riscv.png`,
	},
	{
		id: "tt02-clock",
		name: "Digital Clock",
		description: "Clock display driver - TinyTapeout 02",
		category: "digital",
		source: "tinytapeout",
		attribution: "gregdavill / TinyTapeout",
		sourceUrl: "https://github.com/TinyTapeout/tinytapeout-02",
		license: "Apache-2.0",
		url: "https://raw.githubusercontent.com/TinyTapeout/tinytapeout-02/tt02/gds/gregdavill_clock_top.gds.gz",
		fileSizeMB: 0.3,
		isCompressed: true,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/tt02-clock.png`,
	},

	// ============================================
	// ASIC EXAMPLES (from Symbiotic EDA)
	// ============================================
	{
		id: "asicone-sg13g2",
		name: "ASICONE SG13G2 (cell)",
		description: "Standard cells for IHP SG13G2 process",
		category: "digital",
		source: "symbioticeda",
		attribution: "Ckristian Duran / Symbiotic EDA",
		sourceUrl: "https://gitlab.symbioticeda.com/ckdur.iso/asicone_sg13g2",
		license: "GPL-3.0",
		url: "https://huggingface.co/datasets/jwt625/gdsii/resolve/main/sg13g2.gds",
		fileSizeMB: 1.5,
		isCompressed: false,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/asicone-sg13g2.png`,
	},

	// ============================================
	// DEMO / OTHER EXAMPLES
	// ============================================
	{
		id: "superconducting-antennas",
		name: "Superconducting Dipole Antennas",
		description: "Antenna array photomask layout",
		category: "demo",
		source: "other",
		attribution: "jwt625",
		sourceUrl: "https://huggingface.co/datasets/jwt625/gdsii",
		license: "MIT",
		url: `${EXAMPLES_BASE_URL}/NTNAR04B_100nm_20210714.gds`,
		fileSizeMB: 0.45,
		isCompressed: false,
		previewOverviewUrl: `${PREVIEWS_BASE_URL}/superconducting-antennas.png`,
	},
];

/**
 * Get examples filtered by category
 */
export function getExamplesByCategory(category: Example["category"]): Example[] {
	return EXAMPLES.filter((e) => e.category === category);
}

/**
 * Get an example by ID
 */
export function getExampleById(id: string): Example | undefined {
	return EXAMPLES.find((e) => e.id === id);
}
