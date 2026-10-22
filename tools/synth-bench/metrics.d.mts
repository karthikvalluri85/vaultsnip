export interface Box { x: number; y: number; w: number; h: number }
export interface Interval { pct: number | null; lo: number | null; hi: number | null; k: number; n: number }
export const EXPOSED: number;
export function covered(b: Box, boxes: Box[]): number;
export function overlap(a: Box, b: Box): number;
export function wilson(k: number, n: number, z?: number): Interval;
