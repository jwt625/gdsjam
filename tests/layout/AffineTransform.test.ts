import { describe, expect, it } from "vitest";
import {
	composeAffine,
	composeGDSHierarchyTransform,
	fromGDSReferenceTransform,
	IDENTITY_GDS_HIERARCHY_TRANSFORM,
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

	it("keeps absolute child angle and magnification independent of its parent", () => {
		const parent = composeGDSHierarchyTransform(IDENTITY_GDS_HIERARCHY_TRANSFORM, {
			x: 100,
			y: 50,
			rotationDegrees: 90,
			magnification: 2,
		});
		const child = composeGDSHierarchyTransform(parent, {
			x: 10,
			y: 0,
			rotationDegrees: 0,
			magnification: 1,
			absoluteRotation: true,
			absoluteMagnification: true,
		});

		expect(transformPoint(child.affine, { x: 0, y: 0 })).toEqual({ x: 100, y: 70 });
		expect(transformPoint(child.affine, { x: 2, y: 1 })).toEqual({ x: 102, y: 71 });
	});
});
