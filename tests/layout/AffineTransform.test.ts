import { describe, expect, it } from "vitest";
import {
	composeAffine,
	fromGDSReferenceTransform,
	rotationAffine,
	transformBoundingBox,
	transformPoint,
	translationAffine,
} from "../../src/lib/layout/AffineTransform";

describe("AffineTransform", () => {
	it("applies inner transforms before outer transforms", () => {
		const transform = composeAffine(translationAffine(10, 20), rotationAffine(90));
		const point = transformPoint(transform, { x: 2, y: 3 });
		expect(point.x).toBeCloseTo(7);
		expect(point.y).toBeCloseTo(22);
	});

	it("uses GDS reflection, rotation, magnification, translation order", () => {
		const transform = fromGDSReferenceTransform({
			x: 100,
			y: 200,
			reflectAcrossX: true,
			rotationDegrees: 90,
			magnification: 2,
		});
		const point = transformPoint(transform, { x: 3, y: 4 });
		expect(point.x).toBeCloseTo(108);
		expect(point.y).toBeCloseTo(206);
	});

	it("transforms all four bounding-box corners", () => {
		const bounds = transformBoundingBox(rotationAffine(90), {
			minX: 0,
			minY: 0,
			maxX: 10,
			maxY: 20,
		});
		expect(bounds.minX).toBeCloseTo(-20);
		expect(bounds.minY).toBeCloseTo(0);
		expect(bounds.maxX).toBeCloseTo(0);
		expect(bounds.maxY).toBeCloseTo(10);
	});
});
