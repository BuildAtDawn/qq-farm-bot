export function partitionOperations(operations: Record<string, number>) {
  const entries = Object.entries(operations)
  return {
    active: entries.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]),
    inactive: entries.filter(([, value]) => !(value > 0)),
  }
}
