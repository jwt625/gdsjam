import type { Point } from "../../types/gds";

const DEBUG_PATH_CONVERSION = import.meta.env.VITE_DEBUG_PARSER === "true";

/**
 * Convert a GDSII PATH element to a POLYGON by creating an outline based on width and pathtype
 *
 * @param centerPoints - Spine/centerline points of the path
 * @param width - Path width in database units
 * @param pathtype - End cap style: 0=flush, 1=round, 2=extended, 4=custom (with BGNEXTN/ENDEXTN)
 * @returns Polygon points forming the path outline
 */
export function pathToPolygon(centerPoints: Point[], width: number, pathtype: number): Point[] {
	if (centerPoints.length === 0) {
		return [];
	}

	// Handle zero-width paths: render as polyline (just return the centerline)
	// Zero-width paths are valid in GDSII and should be rendered as lines
	if (width <= 0) {
		if (DEBUG_PATH_CONVERSION) {
			console.log("[pathToPolygon] Zero-width path, rendering as polyline");
		}
		// Return the centerline as-is for line rendering
		// Note: This will be rendered as a line, not a filled polygon
		return centerPoints;
	}

	const halfWidth = width / 2;
	const leftEdge: Point[] = [];
	const rightEdge: Point[] = [];

	// For each segment, calculate perpendicular offset
	for (let i = 0; i < centerPoints.length; i++) {
		const current = centerPoints[i];
		if (!current) continue;

		const perpendicular = calculatePerpendicular(centerPoints, i);
		const { perpX, perpY } = perpendicular;

		// Create left and right edge points
		leftEdge.push({
			x: current.x + perpX * halfWidth,
			y: current.y + perpY * halfWidth,
		});
		rightEdge.push({
			x: current.x - perpX * halfWidth,
			y: current.y - perpY * halfWidth,
		});
	}

	// Generate end caps based on pathtype
	const startCap = generateStartCap(centerPoints, halfWidth, pathtype);
	const endCap = generateEndCap(centerPoints, halfWidth, pathtype);

	// Combine: startCap + leftEdge + endCap + rightEdge.reverse()
	const outline: Point[] = [];

	if (startCap.length > 0) {
		outline.push(...startCap);
	} else if (leftEdge[0]) {
		// For flush caps, connect the edges directly
		outline.push(leftEdge[0]);
	}

	outline.push(...leftEdge);

	if (endCap.length > 0) {
		outline.push(...endCap);
	}

	outline.push(...rightEdge.reverse());

	// Close the polygon
	if (outline.length > 0 && outline[0]) {
		outline.push({ x: outline[0].x, y: outline[0].y });
	}

	return outline;
}

/**
 * Calculate perpendicular direction at a point along the path
 */
function calculatePerpendicular(
	centerPoints: Point[],
	index: number,
): { perpX: number; perpY: number } {
	const current = centerPoints[index];
	if (!current) return { perpX: 0, perpY: 0 };

	let perpX = 0;
	let perpY = 0;

	if (index === 0) {
		// First point: use direction to next point
		const next = centerPoints[index + 1];
		if (next) {
			const dx = next.x - current.x;
			const dy = next.y - current.y;
			const len = Math.sqrt(dx * dx + dy * dy);
			if (len > 0) {
				perpX = -dy / len;
				perpY = dx / len;
			}
		}
	} else if (index === centerPoints.length - 1) {
		// Last point: use direction from previous point
		const prev = centerPoints[index - 1];
		if (prev) {
			const dx = current.x - prev.x;
			const dy = current.y - prev.y;
			const len = Math.sqrt(dx * dx + dy * dy);
			if (len > 0) {
				perpX = -dy / len;
				perpY = dx / len;
			}
		}
	} else {
		// Middle point: average of incoming and outgoing directions (miter join)
		const prev = centerPoints[index - 1];
		const next = centerPoints[index + 1];
		if (prev && next) {
			const dx1 = current.x - prev.x;
			const dy1 = current.y - prev.y;
			const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

			const dx2 = next.x - current.x;
			const dy2 = next.y - current.y;
			const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

			if (len1 > 0 && len2 > 0) {
				const perp1X = -dy1 / len1;
				const perp1Y = dx1 / len1;
				const perp2X = -dy2 / len2;
				const perp2Y = dx2 / len2;

				perpX = (perp1X + perp2X) / 2;
				perpY = (perp1Y + perp2Y) / 2;

				// Normalize
				const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);
				if (perpLen > 0) {
					perpX /= perpLen;
					perpY /= perpLen;
				}
			}
		}
	}

	return { perpX, perpY };
}

/**
 * Generate start cap for path
 */
function generateStartCap(centerPoints: Point[], halfWidth: number, pathtype: number): Point[] {
	if (pathtype === 0) {
		// Flush: no extension
		return [];
	}

	if (pathtype === 1) {
		// Round: semicircle cap with 8 segments
		const segments = 8;
		const first = centerPoints[0];
		const second = centerPoints[1];
		if (!first || !second) return [];

		const dx = second.x - first.x;
		const dy = second.y - first.y;
		const angle = Math.atan2(dy, dx);

		const cap: Point[] = [];
		for (let j = 0; j <= segments; j++) {
			const theta = angle + Math.PI / 2 + (j / segments) * Math.PI;
			cap.push({
				x: first.x + Math.cos(theta) * halfWidth,
				y: first.y + Math.sin(theta) * halfWidth,
			});
		}
		return cap;
	}

	if (pathtype === 2) {
		// Extended: square end extends by halfWidth
		const first = centerPoints[0];
		const second = centerPoints[1];
		if (!first || !second) return [];

		const dx = second.x - first.x;
		const dy = second.y - first.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len === 0) return [];

		const extX = -(dx / len) * halfWidth;
		const extY = -(dy / len) * halfWidth;
		const perpX = -dy / len;
		const perpY = dx / len;

		return [
			{
				x: first.x + extX + perpX * halfWidth,
				y: first.y + extY + perpY * halfWidth,
			},
			{
				x: first.x + extX - perpX * halfWidth,
				y: first.y + extY - perpY * halfWidth,
			},
		];
	}

	if (pathtype === 4) {
		// Custom extensions (BGNEXTN/ENDEXTN) - not yet supported
		if (DEBUG_PATH_CONVERSION) {
			console.warn("[pathToPolygon] Pathtype 4 (custom) not fully supported, using flush caps");
		}
		return [];
	}

	return [];
}

/**
 * Generate end cap for path
 */
function generateEndCap(centerPoints: Point[], halfWidth: number, pathtype: number): Point[] {
	if (pathtype === 0) {
		// Flush: no extension
		return [];
	}

	if (pathtype === 1) {
		// Round: semicircle cap with 8 segments
		const segments = 8;
		const last = centerPoints[centerPoints.length - 1];
		const secondLast = centerPoints[centerPoints.length - 2];
		if (!last || !secondLast) return [];

		const dx = last.x - secondLast.x;
		const dy = last.y - secondLast.y;
		const angle = Math.atan2(dy, dx);

		const cap: Point[] = [];
		for (let j = 0; j <= segments; j++) {
			const theta = angle - Math.PI / 2 + (j / segments) * Math.PI;
			cap.push({
				x: last.x + Math.cos(theta) * halfWidth,
				y: last.y + Math.sin(theta) * halfWidth,
			});
		}
		return cap;
	}

	if (pathtype === 2) {
		// Extended: square end extends by halfWidth
		const last = centerPoints[centerPoints.length - 1];
		const secondLast = centerPoints[centerPoints.length - 2];
		if (!last || !secondLast) return [];

		const dx = last.x - secondLast.x;
		const dy = last.y - secondLast.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len === 0) return [];

		const extX = (dx / len) * halfWidth;
		const extY = (dy / len) * halfWidth;
		const perpX = -dy / len;
		const perpY = dx / len;

		return [
			{
				x: last.x + extX - perpX * halfWidth,
				y: last.y + extY - perpY * halfWidth,
			},
			{
				x: last.x + extX + perpX * halfWidth,
				y: last.y + extY + perpY * halfWidth,
			},
		];
	}

	if (pathtype === 4) {
		// Custom extensions - not yet supported
		return [];
	}

	return [];
}
