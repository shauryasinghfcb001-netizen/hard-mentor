import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { validateLiveConfiguration } from './live-run-safety.ts';

/** Check only the local TCP endpoint; no authentication or HTTP request. */
export async function preflightZetaris(env: NodeJS.ProcessEnv): Promise<void> {
  validateLiveConfiguration(env, []);
  const url = new URL(env.HM_ZETARIS_URL!);
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    });
    const fail = () => { socket.destroy(); reject(new Error('zetaris_port_unreachable')); };
    socket.setTimeout(2000, fail);
    socket.once('error', fail);
    socket.once('connect', () => { socket.destroy(); resolve(); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await preflightZetaris(process.env); }
  catch (error) {
    const closed = error instanceof Error && error.message === 'zetaris_port_unreachable';
    process.exitCode = closed ? 3 : 2;
    console.error(`live-run preflight: ${closed ? 'Zetaris port closed or unreachable' : 'invalid local configuration'} (exit ${process.exitCode})`);
  }
}
