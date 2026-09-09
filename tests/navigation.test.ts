import { describe, expect, it } from 'vitest';
import {
  canStand,
  moveInOffice,
  officeLayout,
  snapTurn,
  stickVector,
} from '../packages/reference/src/spatial/office-layout';
import type { OfficeLayout } from '../packages/reference/src/spatial/office-layout';

describe('office movement and floor extension seam', () => {
  it('keeps every station clear and reaches the right-wall board by walking around the desk', () => {
    for (const station of Object.values(officeLayout.stations))
      expect(canStand(officeLayout, station)).toBe(true);
    let position = { x: 0, z: 2.32 };
    for (let i = 0; i < 20; i++)
      position = moveInOffice(officeLayout, position, { x: 1, z: 0 }, 0, 0.1);
    for (let i = 0; i < 20; i++)
      position = moveInOffice(officeLayout, position, { x: 0, z: -1 }, 0, 0.1);
    expect(position.x).toBeCloseTo(2.5);
    expect(position.z).toBeCloseTo(-0.18);
    expect(canStand(officeLayout, position)).toBe(true);
  });
  it('stops at furniture and walls, normalizes diagonals and ignores invalid input', () => {
    let position = { x: 0, z: 2.32 };
    for (let i = 0; i < 200; i++)
      position = moveInOffice(officeLayout, position, { x: 0, z: -1 }, 0, 0.1);
    expect(position.z).toBeGreaterThanOrEqual(0.96 + officeLayout.radius);
    for (let i = 0; i < 200; i++)
      position = moveInOffice(officeLayout, position, { x: 1, z: 0 }, 0, 0.1);
    expect(position.x).toBeLessThanOrEqual(3.79 - officeLayout.radius);
    const origin = { x: 0, z: 2.32 },
      diagonal = moveInOffice(officeLayout, origin, { x: 1, z: 1 }, 0, 0.1);
    expect(Math.hypot(diagonal.x, diagonal.z - origin.z)).toBeCloseTo(officeLayout.speed * 0.1);
    expect(moveInOffice(officeLayout, origin, { x: NaN, z: 0 }, 0, 0.1)).toEqual(origin);
    expect(origin).toEqual({ x: 0, z: 2.32 });
  });
  it('uses view-relative movement, a dead zone and one snap per deliberate stick tilt', () => {
    const result = moveInOffice(
      officeLayout,
      { x: 0, z: 2.32 },
      { x: 0, z: -1 },
      -Math.PI / 2,
      0.1,
    );
    expect(result.x).toBeGreaterThan(0);
    expect(result.z).toBeCloseTo(2.32);
    expect(stickVector(0.1, -0.1)).toEqual({ x: 0, z: 0 });
    expect(Math.hypot(...Object.values(stickVector(1, 1)))).toBeCloseTo(1);
    const first = snapTurn(1, true);
    expect(first.radians).toBeCloseTo(-Math.PI / 4);
    expect(snapTurn(1, first.armed).radians).toBe(0);
    expect(snapTurn(-1, snapTurn(0, first.armed).armed).radians).toBeCloseTo(Math.PI / 4);
  });
  it('supports adjoining rooms without a phantom wall at the shared boundary', () => {
    const floor: OfficeLayout = {
      ...officeLayout,
      zones: [
        { id: 'a', minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
        { id: 'b', minX: 2, maxX: 4, minZ: 0, maxZ: 2 },
      ],
      obstacles: [],
    };
    let position = { x: 1, z: 1 };
    for (let i = 0; i < 16; i++) position = moveInOffice(floor, position, { x: 1, z: 0 }, 0, 0.1);
    expect(position.x).toBeCloseTo(3);
  });
});
