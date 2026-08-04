export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionSchema } = await import('./instrumentation-node');
    await assertProductionSchema();
  }
}
