/**
 * An artwork of the tour's own, drawn in code: a traffic light, three lamps in a rounded case.
 * A module in a deck's `artworks/` folder exports a function that receives the icon options
 * (size, color, fill, hand-drawn look) and the attributes of its directive, and returns what
 * the engine should show; `[[artwork: traffic-light #id ...]]` places it like an icon.
 */
import { Circle, RoundedRectangle, VGroup } from 'manim-web';
import type { ArtworkOptions } from 'zoomdeck';

export default function trafficLight({ size = 1, color = '#000000', strokeWidth = 2, attributes }: ArtworkOptions): VGroup {
  const lit = attributes.lit ?? 'green';
  const body = new RoundedRectangle({ width: size * 0.5, height: size, cornerRadius: size * 0.12, color, strokeWidth });
  body.setFill(color, 0.08);
  const lamps = ['red', 'gold', 'green'].map((name, index) => {
    const lamp = new Circle({ radius: size * 0.12, color, strokeWidth });
    lamp.moveTo([0, size * (0.3 - 0.3 * index), 0]);
    lamp.setFill({ red: '#FC6255', gold: '#F0AC5F', green: '#83C167' }[name] as string, lit === name || lit === 'all' ? 1 : 0.15);
    return lamp;
  });
  return new VGroup(body, ...lamps);
}
