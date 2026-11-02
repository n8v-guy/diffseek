import type { Box, Shot } from './config.ts';

export interface Layer { crop: number; left: number; shot: Shot; width: number; }
export interface Note {
  align?: 'center' | 'right';
  arrow?: boolean;
  at: Point;
  below?: { gap: number; id: string };
  body?: string;
  enter?: 'left';
  exit?: 'top';
  group?: string;
  id?: string;
  middle?: boolean;
  routes?: Route[];
  shape?: 'rect' | 'ring';
  target?: Box;
  target2?: Box;
  title: string;
  within?: Point;
}
/** A layer as the canvas page draws it. */
export interface PlacedLayer {
  crop: number;
  height0: number;
  left: number;
  ratio: number;
  src: string;
  width: number;
  width0: number;
  x0: number;
  y0: number;
}
export type Point = [number, number];
export interface Ring { cx: number; cy: number; r: number }
export interface Route {
  from: 'left' | 'right' | 'top';
  offset?: number;
  ring: Ring;
}
export interface Scene {
  accent: string;
  layers: PlacedLayer[];
  masks: Box[];
  notes: Note[];
  tags: Tag[];
}
export interface Tag {
  center?: boolean;
  right?: boolean;
  size?: number;
  text: string;
  x: number;
  y: number;
}
