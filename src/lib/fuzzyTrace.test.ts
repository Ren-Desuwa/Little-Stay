import { describe, expect, it } from 'vitest';
import { distanceMatrix } from './algorithms';
import { fuzzyTrace } from './fuzzyTrace';

describe('Levenshtein playback trace', () => {
  it.each([
    ['', '', 0],
    ['', 'hello', 5],
    ['hello', '', 5],
    ['kitten', 'sitting', 3],
    ['blacony', 'balcony', 2],
    ['pool', 'pool', 0],
    ['é', 'e', 1],
    ['😀', '', 2],
  ])('reveals the production matrix for %s → %s', (a, b, distance) => {
    const trace = fuzzyTrace(a, b);
    const revealed = trace.matrix.map((row) => row.map(() => false));
    expect(trace.matrix).toEqual(distanceMatrix(a, b));
    expect(trace.frames).toHaveLength((a.length + 1) * (b.length + 1));
    trace.frames.forEach((frame, index) => {
      expect(revealed[frame.row][frame.column]).toBe(false);
      expect(frame.value).toBe(trace.matrix[frame.row][frame.column]);
      expect(trace.revealedAt[frame.row][frame.column]).toBe(index + 1);
      if (frame.phase === 'compare') {
        expect(frame.choices).toHaveLength(3);
        frame.choices.forEach(({ cell, base, cost, total }) => {
          expect(revealed[cell.row][cell.column]).toBe(true);
          expect(base).toBe(trace.matrix[cell.row][cell.column]);
          expect(total).toBe(base + cost);
        });
        expect(frame.value).toBe(Math.min(...frame.choices.map(({ total }) => total)));
      } else {
        expect(frame.row === 0 || frame.column === 0).toBe(true);
        expect(frame.value).toBe(frame.row + frame.column);
      }
      revealed[frame.row][frame.column] = true;
    });
    expect(revealed.flat().every(Boolean)).toBe(true);
    expect(trace.frames.at(-1)?.value).toBe(distance);
    expect(trace.path[0]).toEqual({ row: 0, column: 0 });
    expect(trace.path.at(-1)).toEqual({ row: a.length, column: b.length });
    let pathCost = 0;
    trace.path.slice(1).forEach((cell, index) => {
      const previous = trace.path[index];
      const rowChange = cell.row - previous.row;
      const columnChange = cell.column - previous.column;
      expect(rowChange === 0 || rowChange === 1).toBe(true);
      expect(columnChange === 0 || columnChange === 1).toBe(true);
      expect(rowChange + columnChange).toBeGreaterThan(0);
      const cost = rowChange && columnChange ? Number(a[cell.row - 1] !== b[cell.column - 1]) : 1;
      expect(trace.matrix[cell.row][cell.column]).toBe(
        trace.matrix[previous.row][previous.column] + cost,
      );
      pathCost += cost;
    });
    expect(pathCost).toBe(distance);
    expect(trace.alignment.map((edit) => edit.from).join('')).toBe(a);
    expect(trace.alignment.map((edit) => edit.to).join('')).toBe(b);
    expect(trace.alignment.reduce((sum, edit) => sum + edit.cost, 0)).toBe(distance);
    expect(trace.alignment.every((edit) => (edit.operation === 'keep') === (edit.cost === 0))).toBe(
      true,
    );
  });

  it('visits the interior cells in row-major order', () => {
    expect(
      fuzzyTrace('ab', 'cd')
        .frames.filter(({ phase }) => phase === 'compare')
        .map(({ row, column }) => [row, column]),
    ).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ]);
  });
});
