interface ActivityEntry {
  key: string
  adaptedKey: string | null
  status: string
  permanent: boolean
}

/** Only choose an open entry; a manual return to the directory remains a directory. */
export function initialActivityKey(cards: readonly ActivityEntry[]): string | null {
  return cards.find(card => card.adaptedKey === 'milk-tea' && card.status === 'active')?.key
    ?? cards.find(card => !card.permanent && card.status === 'active')?.key
    ?? cards.find(card => card.status === 'active')?.key
    ?? null
}
