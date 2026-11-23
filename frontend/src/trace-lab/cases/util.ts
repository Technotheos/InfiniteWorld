import type { TableRow, DiskRow, RowBase } from '../types';

/** A table row. `extra` carries the hidden role fields. */
export const T = (id: string, cells: Record<string, string>, extra: Partial<RowBase> = {}): TableRow => ({ id, cells, ...extra });
export const byKey = (rows: TableRow[], k: string): TableRow[] => [...rows].sort((a, b) => (a.cells[k] ?? '').localeCompare(b.cells[k] ?? ''));

export const D = (id: string, path: string, size: number, m: string, a: string, c: string, fn: string, state: DiskRow['state'] = 'live', extra: Partial<RowBase> = {}): DiskRow =>
  ({ id, path, size, m, a, c, fn, state, ...extra });

export const KB = 1024, MB = 1024 * 1024, GB = 1024 * MB;
