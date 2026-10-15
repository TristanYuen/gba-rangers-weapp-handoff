export const playerAvatarFallback = (displayName: unknown): string =>
  typeof displayName === 'string' && displayName ? displayName.slice(0, 1) : '—'
