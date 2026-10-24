import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs developer tool, without types
import { validate } from '../../tools/ai-bench/validate.mjs';

const codes = (spec: unknown) => (validate(spec) as { code: string }[]).map((p) => p.code).sort();
const column = { id: 'v1', type: 'column', span: 12, title: 'Sales by Region', dimension: { name: 'Region', members: ['A', 'B'] }, series: [{ name: 'Sales', shape: [100, 40] }] };

describe('AI answer checks (tools/ai-bench)', () => {
  it('a well-formed answer has no problems', () => {
    expect(codes({ title: 'x', rows: [{ height: 'm', visuals: [column] }] })).toEqual([]);
  });
  it('finds what a strict format would prevent', () => {
    const bad = { rows: [{ height: 'xl', visuals: [
      { ...column, span: 5, horizontal: true },
      { ...column, id: 'v2', type: 'spiral', span: 4 },
      { ...column, id: 'v3', span: 4, series: [{ name: 'S', shape: [100] }] },
    ] }] };
    expect(codes(bad)).toEqual(['column-horizontal', 'row-height', 'shape-length', 'spans-not-12', 'unknown-type']);
    expect(codes({ rows: [] })).toEqual(['no-rows']);
    expect(codes(null)).toEqual(['not-an-object']);
  });
});
