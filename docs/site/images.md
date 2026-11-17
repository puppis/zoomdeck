---
title: Images and video
description: SVG and raster images, animated PNG and GIF, and video files played through the browser.
---

<a class="try" href="tour.html#slide=images">Open in the tour ↗</a>

```markdown
![Vector artwork](assets/slides.svg){#svg x=-6.5 y=-2.6 width=4}

![Plays once when revealed](assets/orbit.png){#once x=0 y=-2.6 width=3 play=once step=1}

![Loops until the next click](assets/orbit.png){#loop right-of:#once buff=1.5 width=3 play=loop step=2 hide=3}

![A recording](assets/clip.mp4){#movie width=7.5 play=once step=4}
```

## Images

An image occupies a block of its own, is centered on `x`, `y` (or placed by `anchor=`, `at=`
and the relative constraints), and is sized with `width` (`height` scales it to fit). Paths
resolve relative to the Markdown file, then in the folders `paths` names in the front matter
([Configuration](configuration.html)); `data:` URIs and absolute URLs work too.

- **SVG** files keep nested transforms and inherited styles, and draw their shapes in document
  order, a stroke after a fill lying over it. `<text>` inside an SVG is not rendered: outline text
  before exporting.
- **Clip paths and masks** of an SVG are applied to its shapes when the file loads, so that they
  stay sharp at any zoom and cost nothing while slides move. A clip path lets through what its
  shapes cover; a mask what its light shapes cover (its opaque ones with `mask-type:alpha`, as
  Figma exports them), less its dark ones. Strokes and fills wholly inside keep their curves;
  anything wholly outside goes; a fill across the border, and a stroke nearer the border than half
  its width, are cut along it, as finely sampled polygons. A stroke masked by its own shape, the
  way Figma keeps a stroke inside or outside its shape, keeps the half on the visible side. A
  mask is read by its shapes alone: one that is at least half light or opaque counts as shown, a
  gradient as its color. Clip paths and masks in `objectBoundingBox` units are not applied, and
  their content is drawn in full with a warning. A file that uses `xlink:href` without declaring
  the prefix, as fragments cut out of a larger export often do, loads all the same.
- **Raster** files may be PNG, JPEG, GIF or WebP.

## Animated images

Multi-slide **APNG** and **GIF** files accept `play=`:

| Value | Behaviour |
| --- | --- |
| `play=once` | one complete cycle at the file's frame durations, keeping the last frame |
| `play=loop` | the reveal is its own stop that advances automatically into a browser loop; the next click leaves the loop |

A hidden animated image shown again restarts at its first frame; images sharing a step play
together, finite ones before loops. Single-slide files cannot request playback.

## Video

A video file (`.mp4`, `.m4v`, `.webm`, `.ogv`, `.ogg`, `.mov`) uses the same syntax and plays through the
browser's decoder:

- `play=once` plays one pass as its own stop; `play=loop` keeps looping until the next click;
  without `play` the first frame is shown as a still.
- Videos start **muted** so that playback is never blocked by autoplay rules; `muted=false`
  turns the sound on (the first click of the deck counts as the gesture browsers require).
- Playback follows the clip's clock: the speed control resyncs rather than slows the video, and
  backward navigation jumps over a video instead of rewinding it.
- A clip the browser cannot play, because the file is missing or the codec is not built in
  (Chromium builds without H.264 are common on Linux), is left blank and named in the console;
  the deck loads all the same. WebM clips play in every browser.
- `--one-file` exports embed videos as data URIs, which grows the file quickly; prefer the folder
  export for decks with long videos.
