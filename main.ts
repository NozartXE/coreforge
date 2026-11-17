import { createForgeServer } from './app.ts';

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function main(): Promise<void> {
  const environmentUrl = process.env.MAKEFUN_ENV_URL;
  if (!environmentUrl) {
    console.error('MAKEFUN_ENV_URL is required');
    process.exitCode = 1;
    return;
  }

  const baseUrl = environmentUrl.replace(/\/$/, '');
  const server = createForgeServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine the listening port');
    }

    const registration = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: address.port }),
    });
    if (!registration.ok) {
      throw new Error(`Registration failed with HTTP ${registration.status}`);
    }

    for (;;) {
      try {
        const response = await fetch(`${baseUrl}/done`);
        if (response.ok) {
          const status = (await response.json()) as { done?: unknown };
          if (status.done === true) break;
        }
      } catch {
        // A transient environment failure is retried on the next interval.
      }
      await pause(250);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error: unknown) => {
  console.error('Harness lifecycle failed:', error);
  process.exitCode = 1;
});
