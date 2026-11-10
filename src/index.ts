/** Tree-shaped zooming presentations that run directly in the browser. */
export { Slide, PlaceholderSlide, Visit, walk, startingSlide, resolveSize, DEFAULT_ANIMATION_TIME } from './slides';
export type { SlideOptions, AddChildOptions, ProgramResult } from './slides';
export { Transform, point, positive } from './geometry';
export type { Vec3 } from './geometry';
export {
  SlideContext,
  Presenter,
  PresenterConfig,
  History,
  Clip,
  PlayOp,
  WaitOp,
  FocusOp,
  DelayedAnimation,
} from './runtime';
export type {
  PresenterConfigOptions,
  StopOptions,
  PlayOptions,
  CameraState,
  NavigationData,
  NavigationClip,
  NavigationSlide,
  ProgressEvent,
  Op,
} from './runtime';
export { LocalScene, Display } from './display';
export { defineDeck } from './deck';
export type { DeckDefinition, ResolvedDeck, ViewportSize } from './deck';
export { runDeck, resumedClip } from './player/boot';
export type { RunDeckOptions, RunningDeck } from './player/boot';
export { Player } from './player/player';
export { Stage } from './player/stage';
export { LinkLayer } from './player/links';
export { PlayerUI } from './player/ui';
export { slideKeys, bookmark } from './position';
export type { Bookmark } from './position';
export { coordinateGrid } from './guides';
export { loadDefaultFonts, DEFAULT_TEXT_FONT } from './fonts';
export { MATH_SIZE_RATIO } from './markup/renderer';
export * as engine from 'manim-web';
export { RasterImage, RasterMovie, RasterSource } from './raster';
export { VideoClip, VideoPlay } from './video';
export type { VideoClipOptions, VideoPlayOptions } from './video';
export { IframeHost, IFRAME_HOSTS } from './markup/iframe';
export { IframeLayer } from './player/iframes';
export type { RasterImageOptions, RasterMovieOptions } from './raster';
export {
  MarkupError, ElementSpec, GroupSpec, IncludeSpec, ImportSpec, EventSpec, ActionSpec, NextSpec, SkipNextSpec, SlideSpec, MarkupDocument,
  parseAttributes, parseColor, parseCssColor, parseAt, normalizeStyles, applyStyles, styleRoles,
} from './markup/ast';
export type { InlineSpan, AnimationStep, StepChange, VisibilityChange, SlideItem, Attributes, StyleSheet, AtExpression, ActionKind } from './markup/ast';
export { MarkupParser, ASTTransformer } from './markup/parser';
export { LayoutConfig, MarkupRenderer, placeRelative, positionAnchor, anchorPoint, elementAnchor, applyOpacity } from './markup/renderer';
export type { LayoutConfigOptions, MarkupRendererOptions } from './markup/renderer';
export { MarkupSlide, SlideBuilder } from './markup/slide';
export type { SlideNamespace, SlideBuilderOptions } from './markup/slide';
export { StyledLine, layoutParagraph, inlineWords, baselineY } from './markup/text';
export { layoutCode, tokenizeCode, languageFor, codeThemeFor, DARK_CODE_THEME, LIGHT_CODE_THEME } from './markup/code';
export { PropertyAnimation, makeEffect, enterAnimation, exitAnimation, RATE_FUNCTIONS, EFFECT_NAMES as EFFECTS } from './animations';
export type { PropertyTargets, EffectOptions, AnimationTiming, RateFunction } from './animations';
export type { CodeToken, CodeTheme, TokenClass, CodeLayoutOptions } from './markup/code';
export type { TextRun, MathPiece, MathFactory } from './markup/text';
export { markupDeck, loadDeckConfig } from './markup/deck';
export type { MarkupDeckOptions, DeckConfig } from './markup/deck';
export { svgToMobject, loadSvgMobject } from './svg';
export { sketch, sketchDrawable, sketchSeed, FILL_STYLES, SKETCH_SCALE } from './sketch';
export type { SketchOptions, FillStyle, OutlineMobject } from './sketch';
