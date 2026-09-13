export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { isLocalStandaloneMode } = await import('./lib/engine/localDevMode');
    if (isLocalStandaloneMode()) {
      const { ensureLocalStandaloneEngine } = await import('./lib/engine/localStandaloneServer');
      ensureLocalStandaloneEngine();
    }
  }
}
