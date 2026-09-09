import { Worker } from 'node:worker_threads';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import http from 'node:http';
import { WorkError } from '@statework/core';

export interface ExtractedSource {
  content: string;
  warnings: string[];
}
export function extractSource(name: string, bytes: Uint8Array): Promise<ExtractedSource> {
  if (bytes.byteLength > 8 * 1024 * 1024)
    throw new WorkError('LIMIT', 'File exceeds 8 MiB. Split it into smaller sources.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./source-worker.js', import.meta.url), {
      workerData: { name, bytes },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(
        new WorkError(
          'LIMIT',
          'Extraction timed out. Use a smaller file or paste the relevant text.',
        ),
      );
    }, 30000);
    worker.once('message', (result: ExtractedSource & { error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.error) reject(new WorkError('VALIDATION', result.error));
      else resolve(result);
    });
    worker.once('error', () => {
      clearTimeout(timer);
      reject(
        new WorkError('VALIDATION', 'Could not extract this file. Paste its readable contents.'),
      );
    });
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new WorkError(
            'VALIDATION',
            'Extraction stopped. Use a smaller file or paste its contents.',
          ),
        );
    });
  });
}
export function publicAddress(ip: string): boolean {
  // IPv6 public unicast only; deny mapped IPv4 and all local/link-local/multicast ranges.
  if (isIP(ip) === 6) return /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:(?:db8|0|10|20):/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
/** Explicit public-page capture. No browser cookies, proxy credentials or automatic recursive crawl. */
export async function fetchSource(
  input: string,
  redirects = 0,
): Promise<{ name: string; url: string; contentType: string; bytes: Uint8Array }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WorkError('VALIDATION', 'Use a full public HTTP or HTTPS URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  )
    throw new WorkError(
      'FORBIDDEN',
      'Use a public HTTP or HTTPS URL without credentials or a custom port.',
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new WorkError(
      'FORBIDDEN',
      'Public capture cannot access local or private-network addresses. Paste the page or use an authorized connector.',
    );
  const address = addresses[0]!;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(
      url,
      {
        family: address.family,
        headers: {
          'User-Agent': 'StateWork source capture',
          Accept: 'text/html,text/plain,application/pdf',
        },
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          response.resume();
          if (redirects >= 4 || !response.headers.location)
            return reject(
              new WorkError('VALIDATION', 'Too many redirects. Open and capture the final page.'),
            );
          void fetchSource(new URL(response.headers.location, url).href, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new WorkError(
              'VALIDATION',
              `Source returned HTTP ${response.statusCode}. Open the page and capture its contents.`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024)
            request.destroy(
              new WorkError('LIMIT', 'Source exceeds 8 MiB. Download a smaller section.'),
            );
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            name: url.pathname.split('/').at(-1) || 'page.html',
            url: url.href,
            contentType: response.headers['content-type'] ?? '',
            bytes: new Uint8Array(Buffer.concat(chunks)),
          }),
        );
      },
    );
    const timer = setTimeout(
      () =>
        request.destroy(
          new WorkError('LIMIT', 'Source timed out. Open and capture the page manually.'),
        ),
      15000,
    );
    request.once('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
