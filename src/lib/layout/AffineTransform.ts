import type { BoundingBox, Point } from "../../types/gds";

/** 2D affine matrix using x' = a*x + c*y + e and y' = b*x + d*y + f. */
export interface AffineTransform {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export interface GDSReferenceTransform {
	x: number;
	y: number;
	rotationDegrees?: number;
	reflectAcrossX?: boolean;
	magnification?: number;
}

export const IDENTITY_TRANSFORM: Readonly<AffineTransform> = Object.freeze({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: 0,
	f: 0,
});

/** Compose transforms so the returned matrix applies `inner` and then `outer`. */
export function composeAffine(outer: AffineTransform, inner: AffineTransform): AffineTransform {
	return {
		a: outer.a * inner.a + outer.c * inner.b,
		b: outer.b * inner.a + outer.d * inner.b,
		c: outer.a * inner.c + outer.c * inner.d,
		d: outer.b * inner.c + outer.d * inner.d,
		e: outer.a * inner.e + outer.c * inner.f + outer.e,
		f: outer.b * inner.e + outer.d * inner.f + outer.f,
	};
}

export function translationAffine(x: number, y: number): AffineTransform {
	return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function rotationAffine(degrees: number): AffineTransform {
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
}

export function scaleAffine(x: number, y = x): AffineTransform {
	return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

export function reflectionAcrossXAffine(): AffineTransform {
	return scaleAffine(1, -1);
}

/** GDS order: reflect across X, rotate, magnify, then translate. */
export function fromGDSReferenceTransform(reference: GDSReferenceTransform): AffineTransform {
	const reflection = reference.reflectAcrossX
		? reflectionAcrossXAffine()
		: { ...IDENTITY_TRANSFORM };
	const rotation = rotationAffine(reference.rotationDegrees ?? 0);
	const magnification = scaleAffine(reference.magnification ?? 1);
	const translation = translationAffine(reference.x, reference.y);

	return composeAffine(
		translation,
		composeAffine(magnification, composeAffine(rotation, reflection)),
	);
}

export function transformPoint(transform: AffineTransform, point: Point): Point {
	return {
		x: transform.a * point.x + transform.c * point.y + transform.e,
		y: transform.b * point.x + transform.d * point.y + transform.f,
	};
}

export function transformBoundingBox(transform: AffineTransform, bounds: BoundingBox): BoundingBox {
	const corners = [
		transformPoint(transform, { x: bounds.minX, y: bounds.minY }),
		transformPoint(transform, { x: bounds.maxX, y: bounds.minY }),
		transformPoint(transform, { x: bounds.minX, y: bounds.maxY }),
		transformPoint(transform, { x: bounds.maxX, y: bounds.maxY }),
	];

	return {
		minX: Math.min(...corners.map((point) => point.x)),
		minY: Math.min(...corners.map((point) => point.y)),
		maxX: Math.max(...corners.map((point) => point.x)),
		maxY: Math.max(...corners.map((point) => point.y)),
	};
}
