import type { Box, Shot } from './config.ts';

export type Point = [number, number];
export type Ring = { cx: number; cy: number; r: number };
export type Route = {
  from: 'left' | 'right' | 'top';
  offset?: number;
  ring: Ring;
  via?: Point[];
};
export type Note = {
  id?: string;
  target?: Box;
  target2?: Box;
  arrow?: boolean;
  shape?: 'rect' | 'ring';
  ring?: number;
  inside?: boolean;
  at: Point;
  align?: 'center' | 'right';
  middle?: boolean;
  within?: Point;
  below?: [string, number];
  group?: string;
  enter?: 'left';
  exit?: 'top';
  routes?: Route[];
  title: string;
  body?: string;
};
export type Tag = {
  x: number;
  y: number;
  text: string;
  size?: number;
  center?: boolean;
  right?: boolean;
};
export type Layer = { shot: Shot; left: number; width: number; crop: number };
/** A layer as the canvas page draws it. */
export type PlacedLayer = {
  left: number;
  width: number;
  crop: number;
  ratio: number;
  x0: number;
  y0: number;
  width0: number;
  height0: number;
  src: string;
};
export type Scene = {
  layers: PlacedLayer[];
  masks: Box[];
  tags: Tag[];
  notes: Note[];
  accent: string;
};
