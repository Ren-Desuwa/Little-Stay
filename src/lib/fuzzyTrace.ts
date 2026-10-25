import { distanceMatrix } from './algorithms';

export type DistanceCell = { row: number; column: number };
export type DistanceChoice = {
  cell: DistanceCell;
  operation: 'delete' | 'insert' | 'keep' | 'substitute';
  base: number;
  cost: number;
  total: number;
};
export type DistanceFrame = DistanceCell & {
  phase: 'initialize' | 'compare';
  value: number;
  choices: DistanceChoice[];
};

/** Reveal values from the production matrix in dependency order. */
export function fuzzyTrace(a: string, b: string) {
  const matrix = distanceMatrix(a, b);
  const frames: DistanceFrame[] = [];
  const revealedAt = matrix.map((row) => row.map(() => 0));
  const append = (frame: DistanceFrame) => {
    frames.push(frame);
    revealedAt[frame.row][frame.column] = frames.length;
  };
  for (let column = 0; column <= b.length; column++)
    append({ row: 0, column, phase: 'initialize', value: matrix[0][column], choices: [] });
  for (let row = 1; row <= a.length; row++)
    append({ row, column: 0, phase: 'initialize', value: matrix[row][0], choices: [] });
  for (let row = 1; row <= a.length; row++)
    for (let column = 1; column <= b.length; column++) {
      const same = a[row - 1] === b[column - 1];
      const options = [
        { cell: { row: row - 1, column }, operation: 'delete' as const, cost: 1 },
        { cell: { row, column: column - 1 }, operation: 'insert' as const, cost: 1 },
        {
          cell: { row: row - 1, column: column - 1 },
          operation: same ? ('keep' as const) : ('substitute' as const),
          cost: same ? 0 : 1,
        },
      ];
      append({
        row,
        column,
        phase: 'compare',
        value: matrix[row][column],
        choices: options.map((option) => ({
          ...option,
          base: matrix[option.cell.row][option.cell.column],
          total: matrix[option.cell.row][option.cell.column] + option.cost,
        })),
      });
    }

  // A deterministic optimal alignment; ties prefer the diagonal.
  const path: DistanceCell[] = [];
  let row = a.length;
  let column = b.length;
  while (true) {
    path.push({ row, column });
    if (!row && !column) break;
    if (
      row &&
      column &&
      matrix[row][column] === matrix[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
    ) {
      row--;
      column--;
    } else if (row && matrix[row][column] === matrix[row - 1][column] + 1) {
      row--;
    } else {
      column--;
    }
  }
  path.reverse();
  const alignment = path.slice(1).map((cell, index) => {
    const previous = path[index];
    const from = cell.row > previous.row ? a[cell.row - 1] : '';
    const to = cell.column > previous.column ? b[cell.column - 1] : '';
    const operation: DistanceChoice['operation'] = !from
      ? 'insert'
      : !to
        ? 'delete'
        : from === to
          ? 'keep'
          : 'substitute';
    return { ...cell, from, to, operation, cost: operation === 'keep' ? 0 : 1 };
  });
  return { matrix, frames, revealedAt, path, alignment };
}
