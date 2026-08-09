export function isBossSearchEnabled(
  value: string | undefined = process.env.ENABLE_BOSS_SEARCH,
): boolean {
  return value?.trim().toLowerCase() === 'true';
}
