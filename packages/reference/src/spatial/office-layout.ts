/** Metres in office coordinates. Additional connected zones can form a floor. */
export interface FloorRect {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface RoomPoint {
  x: number;
  z: number;
}
export interface OfficeLayout {
  zones: FloorRect[];
  obstacles: FloorRect[];
  stations: Record<string, RoomPoint & { yaw: number; label: string }>;
  radius: number;
  speed: number;
}
export const officeLayout: OfficeLayout = {
  zones: [{ id: 'office', minX: -3.79, maxX: 3.79, minZ: -2.99, maxZ: 2.95 }],
  obstacles: [
    { id: 'desk', minX: -1.59, maxX: 1.59, minZ: -0.36, maxZ: 0.96 },
    // Reserve the drawer's open extent so a drawer cannot trap the visitor.
    { id: 'cabinets', minX: -2.22, maxX: 2.22, minZ: -2.62, maxZ: -1.08 },
    { id: 'bookcase', minX: -3.65, maxX: -2.82, minZ: -2.8, maxZ: -1.05 },
    { id: 'plant', minX: 2.8, maxX: 3.4, minZ: -2.65, maxZ: -2.04 },
  ],
  stations: {
    desk: { x: 0, z: 2.32, yaw: 0, label: 'Desk' },
    board: { x: 0.8, z: 1.65, yaw: -Math.atan2(2.98, 1.9), label: 'Detective board' },
    window: { x: -2.35, z: -0.15, yaw: Math.PI / 2, label: 'Window' },
  },
  radius: 0.19,
  speed: 1.25,
};
const inside = (point: RoomPoint, rect: FloorRect) =>
  point.x >= rect.minX && point.x <= rect.maxX && point.z >= rect.minZ && point.z <= rect.maxZ;
/** Circle against furniture; perimeter samples allow travel across adjoining zones. */
export function canStand(layout: OfficeLayout, point: RoomPoint): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const sample = {
      x: point.x + Math.cos(angle) * layout.radius,
      z: point.z + Math.sin(angle) * layout.radius,
    };
    if (!layout.zones.some((zone) => inside(sample, zone))) return false;
  }
  if (!layout.zones.some((zone) => inside(point, zone))) return false;
  return !layout.obstacles.some((obstacle) => {
    const x = Math.max(obstacle.minX, Math.min(obstacle.maxX, point.x));
    const z = Math.max(obstacle.minZ, Math.min(obstacle.maxZ, point.z));
    return Math.hypot(point.x - x, point.z - z) < layout.radius;
  });
}
export function stickVector(x: number, y: number, deadZone = 0.22): RoomPoint {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, z: 0 };
  const length = Math.hypot(x, y);
  if (length <= deadZone) return { x: 0, z: 0 };
  const magnitude = Math.min(1, (length - deadZone) / (1 - deadZone));
  return { x: (x / length) * magnitude, z: (y / length) * magnitude };
}
/** x=strafe, z=backward, relative to view yaw. Substeps prevent thin-wall tunnelling. */
export function moveInOffice(
  layout: OfficeLayout,
  position: RoomPoint,
  input: RoomPoint,
  yaw: number,
  seconds: number,
): RoomPoint {
  if (![input.x, input.z, yaw, seconds].every(Number.isFinite) || seconds <= 0)
    return { ...position };
  const length = Math.max(1, Math.hypot(input.x, input.z));
  const distance = layout.speed * Math.min(seconds, 0.1);
  const dx = ((input.x * Math.cos(yaw) + input.z * Math.sin(yaw)) / length) * distance;
  const dz = ((-input.x * Math.sin(yaw) + input.z * Math.cos(yaw)) / length) * distance;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.055));
  let result = { ...position };
  for (let step = 0; step < steps; step++) {
    const nextX = { x: result.x + dx / steps, z: result.z };
    if (canStand(layout, nextX)) result = nextX;
    const nextZ = { x: result.x, z: result.z + dz / steps };
    if (canStand(layout, nextZ)) result = nextZ;
  }
  return result;
}
/** A held stick produces one comfortable snap until it returns to its centre. */
export function snapTurn(axis: number, armed: boolean): { radians: number; armed: boolean } {
  if (!Number.isFinite(axis) || Math.abs(axis) < 0.25) return { radians: 0, armed: true };
  if (armed && Math.abs(axis) > 0.7)
    return { radians: (-Math.sign(axis) * Math.PI) / 4, armed: false };
  return { radians: 0, armed };
}
