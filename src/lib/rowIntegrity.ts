export function partitionByRowIntegrity<T extends { rowIndex: number }>(
  items: T[],
  expectedNames: Map<number, string>,
  actualNames: Map<number, string>,
): { valid: T[]; mismatched: { item: T; expected?: string; actual?: string }[] } {
  const valid: T[] = [];
  const mismatched: { item: T; expected?: string; actual?: string }[] = [];
  for (const item of items) {
    const expected = expectedNames.get(item.rowIndex);
    const actual = actualNames.get(item.rowIndex);
    if (expected !== undefined && actual === expected) {
      valid.push(item);
    } else {
      mismatched.push({ item, expected, actual });
    }
  }
  return { valid, mismatched };
}
