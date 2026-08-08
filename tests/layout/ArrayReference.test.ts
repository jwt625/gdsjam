import { describe, expect, it } from "vitest";
import {
	getArrayReferencePitch,
	getArrayReferencePosition,
} from "../../src/lib/layout/ArrayReference";

describe("ArrayReference", () => {
	const skewed = {
		origin: { x: 100, y: 200 },
		columnEndpoint: { x: 160, y: 230 },
		rowEndpoint: { x: 80, y: 280 },
		columns: 3,
		rows: 4,
	};

	it("preserves both components of both AREF lattice vectors", () => {
		expect(getArrayReferencePitch(skewed)).toEqual({
			column: { x: 20, y: 10 },
			row: { x: -5, y: 20 },
		});
	});

	it("computes deterministic positions without eager expansion", () => {
		expect(getArrayReferencePosition(skewed, 2, 3)).toEqual({ x: 125, y: 280 });
	});

	it("rejects out-of-range indexes", () => {
		expect(() => getArrayReferencePosition(skewed, 3, 0)).toThrow();
		expect(() => getArrayReferencePosition(skewed, 0, 4)).toThrow();
	});
});
