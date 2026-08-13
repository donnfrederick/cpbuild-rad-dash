/**
 * MSW browser sandbox helpers.
 * When MSW worker + handlers are wired, these start/stop mock interception.
 * Currently a stub — wire real MSW worker here when sandbox mode is needed.
 */

export async function startSandbox(): Promise<void> {
  // TODO: import and start MSW browser worker with app handlers
  console.warn("[DevTools] MSW sandbox: no worker configured. Implement startSandbox() in lib/msw/browser.ts.");
}

export async function stopSandbox(): Promise<void> {
  // TODO: stop MSW browser worker
  console.warn("[DevTools] MSW sandbox: no worker configured. Implement stopSandbox() in lib/msw/browser.ts.");
}
