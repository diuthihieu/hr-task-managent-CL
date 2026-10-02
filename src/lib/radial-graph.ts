export interface GraphPosition {
  x: number;
  y: number;
}

/** Subtle deterministic motion that preserves a node's circular ring. */
export function circularMotionPosition(base: GraphPosition, center: GraphPosition, phase: number, elapsedMs: number, focused = false): GraphPosition {
  const dx = base.x - center.x;
  const dy = base.y - center.y;
  const radius = Math.hypot(dx, dy);
  if (radius < 1) return { x: base.x + Math.cos(elapsedMs * 0.00065 + phase) * 2, y: base.y + Math.sin(elapsedMs * 0.00065 + phase) * 2 };
  const angle = Math.atan2(dy, dx) + Math.sin(elapsedMs * 0.00055 + phase) * (focused ? 0.016 : 0.026);
  const movingRadius = Math.max(0, radius + Math.sin(elapsedMs * 0.00105 + phase * 1.7) * (focused ? 2.2 : 4));
  return { x: center.x + Math.cos(angle) * movingRadius, y: center.y + Math.sin(angle) * movingRadius };
}

function ringCapacity(radius: number, spacing: number) {
  const angle = 2 * Math.asin(Math.min(1, spacing / (2 * radius)));
  return Math.max(1, Math.floor((Math.PI * 2) / angle));
}

export interface ConcentricLayoutOptions {
  nodeRadius?: number;
  minGap?: number;
  firstRingRadius?: number;
}

/**
 * Place nodes on deterministic concentric circles around an arbitrary point.
 * Rings grow outwards instead of being squeezed into a fixed rectangle, so
 * even a large Second Brain graph keeps a readable minimum distance.
 */
export function concentricCircularLayout(
  nodeIds: string[],
  center: GraphPosition = { x: 0, y: 0 },
  options: ConcentricLayoutOptions = {}
): Record<string, GraphPosition> {
  const nodeRadius = options.nodeRadius ?? 16;
  const minGap = options.minGap ?? 18;
  const spacing = nodeRadius * 2 + minGap;
  let radius = Math.max(options.firstRingRadius ?? 72, spacing);
  let cursor = 0;
  let ringIndex = 0;
  const positions: Record<string, GraphPosition> = {};

  while (cursor < nodeIds.length) {
    const capacity = ringCapacity(radius, spacing);
    const ids = nodeIds.slice(cursor, cursor + capacity);
    const offset = -Math.PI / 2 + (ringIndex % 2 ? Math.PI / Math.max(1, ids.length) : 0);
    ids.forEach((id, index) => {
      const angle = offset + (index / ids.length) * Math.PI * 2;
      positions[id] = {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    });
    cursor += ids.length;
    radius += spacing;
    ringIndex++;
  }
  return positions;
}

/**
 * Re-centre a complete graph around the node being dragged. Directly linked
 * nodes always occupy the inner circle(s); every other visible node is placed
 * on outer circles. This makes relationships legible without allowing a force
 * simulation to collapse the graph into an arbitrary shape.
 */
export function anchoredCircularGraphLayout(
  nodeIds: string[],
  anchorId: string,
  linkedIds: string[],
  anchor: GraphPosition,
  options: ConcentricLayoutOptions = {}
): Record<string, GraphPosition> {
  const known = new Set(nodeIds);
  const linked = [...new Set(linkedIds)]
    .filter((id) => id !== anchorId && known.has(id))
    .sort();
  const linkedSet = new Set(linked);
  const remaining = nodeIds
    .filter((id) => id !== anchorId && !linkedSet.has(id))
    .sort();
  const nodeRadius = options.nodeRadius ?? 16;
  const minGap = options.minGap ?? 18;
  const spacing = nodeRadius * 2 + minGap;
  const firstRingRadius = Math.max(options.firstRingRadius ?? 72, spacing);
  const positions: Record<string, GraphPosition> = { [anchorId]: anchor };
  const inner = concentricCircularLayout(linked, anchor, { ...options, firstRingRadius });
  Object.assign(positions, inner);
  const outerInnerRadius = linked.length
    ? Math.max(...linked.map((id) => Math.hypot(inner[id].x - anchor.x, inner[id].y - anchor.y)))
    : 0;
  Object.assign(
    positions,
    concentricCircularLayout(remaining, anchor, {
      ...options,
      firstRingRadius: Math.max(firstRingRadius, outerInnerRadius + spacing),
    })
  );
  return positions;
}
