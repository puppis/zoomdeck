/**
 * An artwork of the tour's own made of several parts: five stars joined by thin lines. A
 * module that returns a list of mobjects gives the artwork parts, and a blob around it flows
 * around each of them instead of around their common box.
 */
import { Dot, Line, type Mobject } from 'manim-web';
import type { ArtworkOptions } from 'zoomdeck';

const STARS: Array<[number, number]> = [[-0.5, 0.45], [-0.1, 0.1], [0.3, 0.5], [0.5, -0.25], [-0.25, -0.5]];
const EDGES: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 1]];

export default function constellation({ size = 1, color = '#000000', strokeWidth = 2 }: ArtworkOptions): Mobject[] {
  const points = STARS.map(([x, y]): [number, number, number] => [x * size, y * size, 0]);
  const lines = EDGES.map(([a, b]) => new Line({ start: points[a], end: points[b], color, strokeWidth: strokeWidth / 2 }));
  const stars = points.map((point, index) => new Dot({ point, radius: (index === 1 ? 0.11 : 0.07) * size, color }));
  return [...lines, ...stars];
}
