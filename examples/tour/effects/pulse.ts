/**
 * An effect of the tour's own: the target swells and settles back. A module in a deck's
 * `effects/` folder exports a function that receives the target and the directive's options
 * (color, scale, timing) and returns an animation of the engine; `[[effect: pulse #id, step=N]]`
 * plays it like a built-in effect.
 */
import { thereAndBack, type Mobject } from 'manim-web';
import { PropertyAnimation, type EffectOptions } from 'zoomdeck';

export default function pulse(target: Mobject, { scale = 1.3, color: _color, ...timing }: EffectOptions) {
  return new PropertyAnimation(target, { scale }, { ...timing, rateFunc: thereAndBack });
}
