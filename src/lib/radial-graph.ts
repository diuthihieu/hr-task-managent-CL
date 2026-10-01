export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphBounds {
  width: number;
  height: number;
}

function ringCapacity(radius: number, spacing: number) {
  return Math.max(1, Math.floor((Math.PI * 2 * radius) / spacing));
}

/**
 * Stable circular layout used by the network widget. Small graphs use one
 * ring; larger graphs use concentric rings so nodes never collapse into an
 * amorphous force-directed shape.
 */
export function circularGraphLayout(
  nodeIds: string[],
  bounds: GraphBounds,
  options: { nodeRadius?: number; minGap?: number } = {}
): Record<string, GraphPosition> {
  const nodeRadius = options.nodeRadius ?? 16;
  const minGap = options.minGap ?? 18;
  const spacing = nodeRadius * 2 + minGap;
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  if (nodeIds.length === 0) return {};
  if (nodeIds.length === 1) return { [nodeIds[0]]: center };

  const outerRadius = Math.max(spacing, Math.min(bounds.width, bounds.height) / 2 - nodeRadius - 14);
  const rings: Array<{ radius: number; ids: string[] }> = [];
  let remaining = [...nodeIds];
  let radius = outerRadius;
  while (remaining.length > 0) {
    const capacity = ringCapacity(radius, spacing);
    const count = Math.min(capacity, remaining.length);
    rings.push({ radius, ids: remaining.slice(0, count) });
    remaining = remaining.slice(count);
    radius = Math.max(spacing, radius - spacing);
  }

  const positions: Record<string, GraphPosition> = {};
  for (const [ringIndex, ring] of rings.entries()) {
    const offset = -Math.PI / 2 + (ringIndex % 2 ? Math.PI / Math.max(1, ring.ids.length) : 0);
    ring.ids.forEach((id, index) => {
      const angle = offset + (index / ring.ids.length) * Math.PI * 2;
      positions[id] = {
        x: center.x + Math.cos(angle) * ring.radius,
        y: center.y + Math.sin(angle) * ring.radius,
      };
    });
  }
  return positions;
}

/** Arrange direct neighbours as evenly spaced concentric circles around the
 * dragged/focused node. The anchor is clamped so every ring remains visible. */
export function linkedCircularLayout(
  anchorId: string,
  linkedIds: string[],
  anchor: GraphPosition,
  bounds: GraphBounds,
  current: Record<string, GraphPosition>,
  options: { nodeRadius?: number; minGap?: number } = {}
): Record<string, GraphPosition> {
  const nodeRadius = options.nodeRadius ?? 16;
  const minGap = options.minGap ?? 18;
  const spacing = nodeRadius * 2 + minGap;
  const uniqueLinked = [...new Set(linkedIds)].filter((id) => id !== anchorId && current[id]);
  if (!uniqueLinked.length) {
    return {
      ...current,
      [anchorId]: {
        x: Math.max(nodeRadius, Math.min(bounds.width - nodeRadius, anchor.x)),
        y: Math.max(nodeRadius, Math.min(bounds.height - nodeRadius, anchor.y)),
      },
    };
  }

  const maxOuterRadius = Math.max(72, Math.min(bounds.width, bounds.height) / 2 - nodeRadius - 6);
  const rings: Array<{ radius: number; ids: string[] }> = [];
  let cursor = 0;
  let radius = 72;
  while (cursor < uniqueLinked.length) {
    const boundedRadius = Math.min(radius, maxOuterRadius);
    const capacity = ringCapacity(boundedRadius, spacing);
    const ids = uniqueLinked.slice(cursor, cursor + capacity);
    rings.push({ radius: boundedRadius, ids });
    cursor += ids.length;
    radius += spacing;
  }
  const outerRadius = rings.at(-1)?.radius ?? 72;
  const margin = outerRadius + nodeRadius + 6;
  const safeAnchor = {
    x: Math.max(Math.min(margin, bounds.width / 2), Math.min(bounds.width - Math.min(margin, bounds.width / 2), anchor.x)),
    y: Math.max(Math.min(margin, bounds.height / 2), Math.min(bounds.height - Math.min(margin, bounds.height / 2), anchor.y)),
  };

  const next = { ...current, [anchorId]: safeAnchor };
  for (const [ringIndex, ring] of rings.entries()) {
    const { radius, ids } = ring;
    ids.forEach((id, index) => {
      const angle = -Math.PI / 2 + (index / ids.length) * Math.PI * 2 + (ringIndex % 2 ? Math.PI / ids.length : 0);
      next[id] = {
        x: safeAnchor.x + Math.cos(angle) * radius,
        y: safeAnchor.y + Math.sin(angle) * radius,
      };
    });
  }
  return next;
}
