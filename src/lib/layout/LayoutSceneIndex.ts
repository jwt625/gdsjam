import type { BoundingBox, CellReference, GDSDocument, Point, Polygon } from "../../types/gds";
import { fromGDSReferenceTransform, transformBoundingBox } from "./AffineTransform";
import { type ArrayReferenceLattice, getArrayReferencePitch } from "./ArrayReference";

export type SceneIndexDiagnostic =
	| {
			kind: "unresolved-reference";
			cellName: string;
			referencedCellName: string;
			path: string;
	  }
	| {
			kind: "cyclic-reference";
			cellName: string;
			referencedCellName: string;
			path: string;
	  };

export interface ScenePolygon {
	id: string;
	sourceOrdinal: number;
	polygon: Polygon;
}

interface SceneReferenceBase {
	id: string;
	sourceOrdinal: number;
	cellRef: string;
	origin: Point;
	rotation: number;
	mirror: boolean;
	magnification: number;
	absoluteRotation: boolean;
	absoluteMagnification: boolean;
}

export interface SceneSingleReference extends SceneReferenceBase {
	kind: "sref";
}

export interface SceneArrayReference extends SceneReferenceBase {
	kind: "aref";
	lattice: ArrayReferenceLattice;
}

export type SceneReference = SceneSingleReference | SceneArrayReference;

export interface SceneCell {
	id: string;
	name: string;
	polygons: readonly ScenePolygon[];
	references: readonly SceneReference[];
	/** Bounds of cell-local geometry only. */
	localBounds: BoundingBox;
	/** Bounds of local geometry and all resolvable descendants. */
	bounds: BoundingBox;
}

export type TopCellSelection =
	| { mode: "required" }
	| { mode: "single"; cellName: string }
	| { mode: "all" };

export interface HierarchyPath {
	path: string;
	cellName: string;
	referenceId?: string;
}

export interface SceneIndexBuildStatistics {
	/** Cells whose hierarchical bounds were actually evaluated (cache misses). */
	boundsComputations: number;
	/** Shared-subtree bounds lookups served from the memoized result. */
	boundsCacheHits: number;
}

export interface LayoutSceneIndex {
	id: string;
	cells: ReadonlyMap<string, SceneCell>;
	topCells: readonly string[];
	aggregateBounds: BoundingBox;
	diagnostics: readonly SceneIndexDiagnostic[];
	buildStatistics: Readonly<SceneIndexBuildStatistics>;
	initialSelection: TopCellSelection;
	getSelectedBounds(selection: TopCellSelection): BoundingBox | null;
	selectTopCell(cellName: string): TopCellSelection;
	showAllTopCells(): TopCellSelection;
	getHierarchyPaths(selection?: TopCellSelection): readonly HierarchyPath[];
}

type OptionalBounds = BoundingBox | null;

const SCENE_INDEX_ID_SCHEMA_VERSION = 1;

function unionBounds(left: OptionalBounds, right: OptionalBounds): OptionalBounds {
	if (!left) return right ? { ...right } : null;
	if (!right) return { ...left };
	return {
		minX: Math.min(left.minX, right.minX),
		minY: Math.min(left.minY, right.minY),
		maxX: Math.max(left.maxX, right.maxX),
		maxY: Math.max(left.maxY, right.maxY),
	};
}

function zeroBounds(bounds: OptionalBounds): BoundingBox {
	return bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

class StableHasher {
	private hash = 0x811c9dc5;

	update(value: string | number | boolean | undefined): void {
		const encoded = value === undefined ? "u" : `${typeof value}:${String(value)}`;
		for (let index = 0; index < encoded.length; index++) {
			this.hash ^= encoded.charCodeAt(index);
			this.hash = Math.imul(this.hash, 0x01000193);
		}
		// Field separator prevents ambiguous concatenations without allocating a
		// geometry-sized serialized document.
		this.hash ^= 0xff;
		this.hash = Math.imul(this.hash, 0x01000193);
	}

	digest(): string {
		return (this.hash >>> 0).toString(16).padStart(8, "0");
	}
}

function sourceReferences(document: GDSDocument, cellName: string): readonly CellReference[] {
	const cell = document.cells.get(cellName);
	if (!cell) return [];
	// Newly parsed documents always set `references`, even when it is empty.
	// Falling back only when the field is absent supports older/programmatic
	// documents; it cannot reinterpret a parsed expanded AREF as one lattice.
	return cell.references ?? cell.instances;
}

function normalizeReference(
	documentId: string,
	cellName: string,
	reference: CellReference,
	ordinal: number,
): SceneReference {
	const common: SceneReferenceBase = {
		id: `${documentId}/cell:${encodeURIComponent(cellName)}/ref:${ordinal}`,
		sourceOrdinal: ordinal,
		cellRef: reference.cellRef,
		origin: { x: reference.x, y: reference.y },
		rotation: reference.rotation,
		mirror: reference.mirror,
		magnification: reference.magnification,
		absoluteRotation: reference.absoluteRotation ?? false,
		absoluteMagnification: reference.absoluteMagnification ?? false,
	};

	if (
		reference.arrayCols !== undefined &&
		reference.arrayRows !== undefined &&
		reference.arrayColumnVector &&
		reference.arrayRowVector
	) {
		return {
			...common,
			kind: "aref",
			lattice: {
				origin: { ...common.origin },
				columnEndpoint: {
					x: common.origin.x + reference.arrayColumnVector.x,
					y: common.origin.y + reference.arrayColumnVector.y,
				},
				rowEndpoint: {
					x: common.origin.x + reference.arrayRowVector.x,
					y: common.origin.y + reference.arrayRowVector.y,
				},
				columns: reference.arrayCols,
				rows: reference.arrayRows,
			},
		};
	}

	return { ...common, kind: "sref" };
}

function referenceBounds(reference: SceneReference, childBounds: BoundingBox): BoundingBox {
	const base = transformBoundingBox(
		fromGDSReferenceTransform({
			x: reference.origin.x,
			y: reference.origin.y,
			rotationDegrees: reference.rotation,
			reflectAcrossX: reference.mirror,
			magnification: reference.magnification,
		}),
		childBounds,
	);
	if (reference.kind === "sref") return base;

	const pitch = getArrayReferencePitch(reference.lattice);
	const columnOffset = {
		x: pitch.column.x * (reference.lattice.columns - 1),
		y: pitch.column.y * (reference.lattice.columns - 1),
	};
	const rowOffset = {
		x: pitch.row.x * (reference.lattice.rows - 1),
		y: pitch.row.y * (reference.lattice.rows - 1),
	};
	const offsets = [
		{ x: 0, y: 0 },
		columnOffset,
		rowOffset,
		{ x: columnOffset.x + rowOffset.x, y: columnOffset.y + rowOffset.y },
	];
	return {
		minX: base.minX + Math.min(...offsets.map((offset) => offset.x)),
		minY: base.minY + Math.min(...offsets.map((offset) => offset.y)),
		maxX: base.maxX + Math.max(...offsets.map((offset) => offset.x)),
		maxY: base.maxY + Math.max(...offsets.map((offset) => offset.y)),
	};
}

function selectionRoots(index: LayoutSceneIndex, selection: TopCellSelection): readonly string[] {
	if (selection.mode === "required") return [];
	return selection.mode === "all" ? index.topCells : [selection.cellName];
}

/** Build a compact, hierarchy-preserving index without flattening cell polygons. */
export function createLayoutSceneIndex(document: GDSDocument): LayoutSceneIndex {
	const hasher = new StableHasher();
	hasher.update("layout-scene-index");
	hasher.update(SCENE_INDEX_ID_SCHEMA_VERSION);
	hasher.update(document.name);
	hasher.update(document.units.database);
	hasher.update(document.units.user);
	for (const topCell of [...document.topCells].sort()) hasher.update(topCell);
	const orderedCells = [...document.cells.values()].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
	for (const cell of orderedCells) {
		hasher.update(cell.name);
		hasher.update(cell.polygons.length);
		for (const polygon of cell.polygons) {
			hasher.update(polygon.layer);
			hasher.update(polygon.datatype);
			hasher.update(polygon.points.length);
			for (const point of polygon.points) {
				hasher.update(point.x);
				hasher.update(point.y);
			}
		}
		hasher.update(cell.texts.length);
		for (const text of cell.texts) {
			hasher.update(text.content);
			hasher.update(text.layer);
			hasher.update(text.textType);
			hasher.update(text.origin.x);
			hasher.update(text.origin.y);
			hasher.update(text.rotation);
			hasher.update(text.mirror);
			hasher.update(text.magnification);
			hasher.update(text.absoluteRotation);
			hasher.update(text.absoluteMagnification);
			hasher.update(text.presentation);
			hasher.update(text.boundsKind);
		}
		const references = sourceReferences(document, cell.name);
		hasher.update(references.length);
		for (const reference of references) {
			hasher.update(reference.cellRef);
			hasher.update(reference.x);
			hasher.update(reference.y);
			hasher.update(reference.rotation);
			hasher.update(reference.mirror);
			hasher.update(reference.magnification);
			hasher.update(reference.absoluteRotation);
			hasher.update(reference.absoluteMagnification);
			hasher.update(reference.arrayRows);
			hasher.update(reference.arrayCols);
			hasher.update(reference.arrayColumnVector?.x);
			hasher.update(reference.arrayColumnVector?.y);
			hasher.update(reference.arrayRowVector?.x);
			hasher.update(reference.arrayRowVector?.y);
		}
	}
	const documentId = `gds:${hasher.digest()}`;
	const normalized = new Map<string, Omit<SceneCell, "bounds"> & { bounds?: BoundingBox }>();

	for (const cell of document.cells.values()) {
		const polygons = cell.polygons.map((polygon, ordinal) => ({
			id: `${documentId}/cell:${encodeURIComponent(cell.name)}/polygon:${ordinal}`,
			sourceOrdinal: ordinal,
			polygon,
		}));
		const localBounds = zeroBounds(
			cell.polygons.reduce<OptionalBounds>(
				(bounds, polygon) => unionBounds(bounds, polygon.boundingBox),
				null,
			),
		);
		normalized.set(cell.name, {
			id: `${documentId}/cell:${encodeURIComponent(cell.name)}`,
			name: cell.name,
			polygons,
			references: sourceReferences(document, cell.name).map((reference, ordinal) =>
				normalizeReference(documentId, cell.name, reference, ordinal),
			),
			localBounds,
		});
	}

	const diagnostics: SceneIndexDiagnostic[] = [];
	const diagnosticKeys = new Set<string>();
	const addDiagnostic = (diagnostic: SceneIndexDiagnostic) => {
		const key = `${diagnostic.kind}:${diagnostic.path}`;
		if (!diagnosticKeys.has(key)) {
			diagnosticKeys.add(key);
			diagnostics.push(diagnostic);
		}
	};

	// Diagnostics are a topology pass rather than a side effect of bounds
	// evaluation. This keeps diagnostic coverage deterministic when shared
	// descendants are served from the bounds cache.
	for (const cellName of [...normalized.keys()].sort()) {
		const cell = normalized.get(cellName);
		if (!cell) continue;
		for (const reference of cell.references) {
			if (!normalized.has(reference.cellRef)) {
				addDiagnostic({
					kind: "unresolved-reference",
					cellName,
					referencedCellName: reference.cellRef,
					path: `${cellName}/ref:${reference.sourceOrdinal}->${reference.cellRef}`,
				});
			}
		}
	}

	const topologyState = new Map<string, "active" | "complete">();
	const visitTopology = (cellName: string, activePath: readonly string[]): void => {
		topologyState.set(cellName, "active");
		const cell = normalized.get(cellName);
		if (cell) {
			for (const reference of cell.references) {
				if (!normalized.has(reference.cellRef)) continue;
				const segment = `ref:${reference.sourceOrdinal}->${reference.cellRef}`;
				if (topologyState.get(reference.cellRef) === "active") {
					addDiagnostic({
						kind: "cyclic-reference",
						cellName,
						referencedCellName: reference.cellRef,
						path: [...activePath, segment].join("/"),
					});
				} else if (!topologyState.has(reference.cellRef)) {
					visitTopology(reference.cellRef, [...activePath, segment]);
				}
			}
		}
		topologyState.set(cellName, "complete");
	};
	for (const cellName of [...normalized.keys()].sort()) {
		if (!topologyState.has(cellName)) visitTopology(cellName, [cellName]);
	}

	const boundsCache = new Map<string, OptionalBounds>();
	const buildStatistics: SceneIndexBuildStatistics = {
		boundsComputations: 0,
		boundsCacheHits: 0,
	};
	type BoundsResult = { bounds: OptionalBounds; cacheable: boolean };
	const computeBounds = (cellName: string, active: Set<string>): BoundsResult => {
		if (boundsCache.has(cellName)) {
			buildStatistics.boundsCacheHits++;
			return { bounds: boundsCache.get(cellName) ?? null, cacheable: true };
		}
		const cell = normalized.get(cellName);
		if (!cell) return { bounds: null, cacheable: true };
		buildStatistics.boundsComputations++;
		let bounds: OptionalBounds = cell.polygons.reduce<OptionalBounds>(
			(current, polygon) => unionBounds(current, polygon.polygon.boundingBox),
			null,
		);
		let cacheable = true;
		for (const reference of cell.references) {
			if (!normalized.has(reference.cellRef)) continue;
			if (active.has(reference.cellRef)) {
				cacheable = false;
				continue;
			}
			active.add(reference.cellRef);
			const child = computeBounds(reference.cellRef, active);
			active.delete(reference.cellRef);
			cacheable &&= child.cacheable;
			if (child.bounds) bounds = unionBounds(bounds, referenceBounds(reference, child.bounds));
		}
		if (cacheable) boundsCache.set(cellName, bounds);
		return { bounds, cacheable };
	};

	const cells = new Map<string, SceneCell>();
	for (const [cellName, cell] of normalized) {
		cells.set(cellName, {
			...cell,
			bounds: zeroBounds(computeBounds(cellName, new Set([cellName])).bounds),
		});
	}

	const topCells = [...document.topCells].sort();
	const aggregateBounds = zeroBounds(
		topCells.reduce<OptionalBounds>(
			(bounds, name) => unionBounds(bounds, cells.get(name)?.bounds ?? null),
			null,
		),
	);
	const initialSelection: TopCellSelection =
		topCells.length === 1
			? { mode: "single", cellName: topCells[0] as string }
			: { mode: "required" };

	const index: LayoutSceneIndex = {
		id: documentId,
		cells,
		topCells,
		aggregateBounds,
		diagnostics,
		buildStatistics,
		initialSelection,
		getSelectedBounds(selection) {
			if (selection.mode === "required") return null;
			if (selection.mode === "all") return { ...aggregateBounds };
			const cell = cells.get(selection.cellName);
			if (!cell || !topCells.includes(selection.cellName)) {
				throw new Error(`Unknown top cell: ${selection.cellName}`);
			}
			return { ...cell.bounds };
		},
		selectTopCell(cellName) {
			if (!topCells.includes(cellName)) throw new Error(`Unknown top cell: ${cellName}`);
			return { mode: "single", cellName };
		},
		showAllTopCells() {
			return { mode: "all" };
		},
		getHierarchyPaths(selection = initialSelection) {
			const paths: HierarchyPath[] = [];
			const visit = (cellName: string, path: string, active: ReadonlySet<string>) => {
				paths.push({ path, cellName });
				const cell = cells.get(cellName);
				if (!cell) return;
				for (const reference of cell.references) {
					const referencePath = `${path}/ref:${reference.sourceOrdinal}`;
					paths.push({
						path: referencePath,
						cellName: reference.cellRef,
						referenceId: reference.id,
					});
					if (!cells.has(reference.cellRef) || active.has(reference.cellRef)) continue;
					visit(
						reference.cellRef,
						`${referencePath}/cell:${encodeURIComponent(reference.cellRef)}`,
						new Set([...active, reference.cellRef]),
					);
				}
			};
			for (const root of selectionRoots(index, selection)) {
				visit(root, `top:${encodeURIComponent(root)}`, new Set([root]));
			}
			return paths;
		},
	};

	return index;
}
