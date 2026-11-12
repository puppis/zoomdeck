/** Slide-local reference geometry for authoring layouts. */
import { Line, Text, VGroup, Group, type Mobject } from 'manim-web';

/** Draw unit grid lines and small axis labels inside a logical canvas. */
export function coordinateGrid(width: number, height: number): Mobject {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = Math.ceil(-halfWidth); x <= Math.floor(halfWidth); x++) xs.push(x);
  for (let y = Math.ceil(-halfHeight); y <= Math.floor(halfHeight); y++) ys.push(y);
  const lines = new VGroup();
  for (const x of xs) {
    lines.add(new Line({ start: [x, -halfHeight, 0], end: [x, halfHeight, 0], color: '#D3D3D3', strokeWidth: 0.6 }));
  }
  for (const y of ys) {
    lines.add(new Line({ start: [-halfWidth, y, 0], end: [halfWidth, y, 0], color: '#D3D3D3', strokeWidth: 0.6 }));
  }
  const labels = new Group();
  const addLabel = (coordinate: number, center: [number, number, number]) => {
    const label = new Text({ text: String(coordinate), fontSize: 12, color: '#AAAAAA' });
    const target = Math.min(0.14, height / 4, width / 4);
    if (label.getHeight() > 0) label.scale(target / label.getHeight());
    // Keep labels for boundary coordinates inside the canvas as well.
    const limitX = halfWidth - label.getWidth() / 2;
    const limitY = halfHeight - label.getHeight() / 2;
    label.moveTo([
      Math.max(-limitX, Math.min(limitX, center[0])),
      Math.max(-limitY, Math.min(limitY, center[1])),
      0,
    ]);
    labels.add(label);
  };
  for (const x of xs) addLabel(x, [x, -0.16, 0]);
  for (const y of ys) if (y !== 0) addLabel(y, [0.16, y, 0]); // The origin is labelled on the horizontal axis.
  return new Group(lines, labels);
}
