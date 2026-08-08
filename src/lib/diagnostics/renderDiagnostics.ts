import type { GDSDocument } from "../../types/gds";

export type RenderCompletenessStatus =
	| "pending"
	| "complete"
	| "partial-unsupported"
	| "partial-unresolved"
	| "partial-cycle"
	| "partial-budget"
	| "partial-depth"
	| "failed";

export interface RenderDiagnosticIssue {
	code:
		| "unsupported"
		| "unresolved-reference"
		| "reference-cycle"
		| "polygon-budget"
		| "hierarchy-depth"
		| "render-failed";
	message: string;
	count?: number;
}

export interface RenderDiagnostics {
	status: RenderCompletenessStatus;
	issues: RenderDiagnosticIssue[];
	renderedPolygons?: number;
	polygonBudget?: number;
}

/** Optional parser-owned diagnostics supported without coupling the renderer to parser internals. */
interface DocumentWithDiagnostics extends GDSDocument {
	diagnostics?: {
		unsupportedElements?: Record<string, number>;
	};
}

export const pendingRenderDiagnostics = (): RenderDiagnostics => ({
	status: "pending",
	issues: [],
});

function findReferenceProblems(document: GDSDocument): RenderDiagnosticIssue[] {
	const unresolved = new Map<string, number>();
	for (const cell of document.cells.values()) {
		for (const instance of cell.instances) {
			if (!document.cells.has(instance.cellRef)) {
				const key = `${cell.name} → ${instance.cellRef}`;
				unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
			}
		}
	}

	const issues: RenderDiagnosticIssue[] = Array.from(unresolved, ([reference, count]) => ({
		code: "unresolved-reference",
		message: `Unresolved cell reference: ${reference}`,
		count,
	}));

	const visited = new Set<string>();
	const active = new Set<string>();
	const reportedCycles = new Set<string>();
	const visit = (cellName: string, path: string[]): void => {
		if (active.has(cellName)) {
			const start = path.indexOf(cellName);
			const cycle = [...path.slice(start), cellName].join(" → ");
			if (!reportedCycles.has(cycle)) {
				reportedCycles.add(cycle);
				issues.push({ code: "reference-cycle", message: `Cell reference cycle: ${cycle}` });
			}
			return;
		}
		if (visited.has(cellName)) return;
		visited.add(cellName);
		active.add(cellName);
		const cell = document.cells.get(cellName);
		if (cell) {
			for (const instance of cell.instances) {
				if (document.cells.has(instance.cellRef)) visit(instance.cellRef, [...path, cellName]);
			}
		}
		active.delete(cellName);
	};

	for (const cellName of document.cells.keys()) visit(cellName, []);
	return issues;
}

export function buildRenderDiagnostics(
	document: GDSDocument,
	options: {
		budgetExhausted: boolean;
		depthLimited: boolean;
		renderedPolygons: number;
		polygonBudget: number;
	},
): RenderDiagnostics {
	const issues = findReferenceProblems(document);
	const unsupported = (document as DocumentWithDiagnostics).diagnostics?.unsupportedElements;
	if (unsupported) {
		for (const [element, count] of Object.entries(unsupported)) {
			if (count > 0) {
				issues.push({
					code: "unsupported",
					message: `Unsupported ${element} element${count === 1 ? "" : "s"} were not rendered`,
					count,
				});
			}
		}
	}
	if (options.budgetExhausted) {
		issues.push({
			code: "polygon-budget",
			message: `Polygon budget reached after ${options.renderedPolygons.toLocaleString()} polygon${options.renderedPolygons === 1 ? "" : "s"}`,
		});
	}
	if (options.depthLimited) {
		issues.push({
			code: "hierarchy-depth",
			message: "Hierarchy depth limit omitted referenced-cell geometry",
		});
	}

	let status: RenderCompletenessStatus = "complete";
	if (issues.some((issue) => issue.code === "polygon-budget")) status = "partial-budget";
	else if (issues.some((issue) => issue.code === "hierarchy-depth")) status = "partial-depth";
	else if (issues.some((issue) => issue.code === "unsupported")) status = "partial-unsupported";
	else if (issues.some((issue) => issue.code === "unresolved-reference"))
		status = "partial-unresolved";
	else if (issues.some((issue) => issue.code === "reference-cycle")) status = "partial-cycle";

	return {
		status,
		issues,
		renderedPolygons: options.renderedPolygons,
		polygonBudget: options.polygonBudget,
	};
}

export function failedRenderDiagnostics(error: unknown): RenderDiagnostics {
	const message = error instanceof Error ? error.message : String(error);
	return { status: "failed", issues: [{ code: "render-failed", message }] };
}

export function renderStatusMessage(diagnostics: RenderDiagnostics): string {
	switch (diagnostics.status) {
		case "complete":
			return "Render complete";
		case "pending":
			return "Rendering…";
		case "failed":
			return "Rendering failed";
		default:
			return "Render incomplete — some geometry may be missing";
	}
}
