import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { manifestVersion } from '../config/manifest-version.ts';

const exec = promisify(execFile);
const root = join(import.meta.dirname, '..');
const geckoId = 'diffseek@n8v.me';
const pullUrl = 'https://github.com/octo/repo/pull/8/changes';

async function validatePackage(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  const { stdout: shallow } = await exec('git', ['rev-parse', '--is-shallow-repository'], { cwd: root });
  assert.equal(shallow.trim(), 'false', 'Firefox package smoke requires full Git history');
  const { stdout: count } = await exec('git', ['rev-list', '--count', 'HEAD'], { cwd: root });
  const version = manifestVersion(pkg.version, Number(count));
  const archive = join(root, '.output', `${pkg.name}-${version}-firefox.zip`);

  await exec('unzip', ['-tq', archive]);
  const { stdout } = await exec('unzip', ['-p', archive, 'manifest.json']);
  const manifest = JSON.parse(stdout) as {
    manifest_version: number;
    version: string;
    browser_specific_settings?: { gecko?: { id?: string } };
  };
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, version);
  assert.equal(manifest.browser_specific_settings?.gecko?.id, geckoId);
  return archive;
}

function debuggerUrl(stderr: Readable, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: stderr, signal });
    stderr.once('close', () => lines.close());
    lines.on('line', (line) => {
      console.error(line);
      const match = /^WebDriver BiDi listening on (ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+)$/.exec(line);
      if (match?.[1]) resolve(`${match[1]}/session`);
    });
    lines.once('error', reject);
    lines.once('close', () => reject(new Error(signal.aborted
      ? 'Timed out waiting for the Firefox WebDriver BiDi banner'
      : 'Firefox did not start its WebDriver BiDi listener')));
  });
}

type Reply = { id: number } & (
  | { type: 'success'; result: unknown }
  | { type: 'error'; error: string; message: string }
);
type BlockedRequest = {
  type: 'event';
  method: string;
  params: { isBlocked: boolean; request: { request: string } };
};

async function runReview(): Promise<void> {
  function waitFor(selector: string, visible?: boolean): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Expected Firefox fixture element: ${selector}`));
      }, 10_000);
      function check() {
        const element = document.querySelector<HTMLElement>(selector);
        if (element == null) return;
        if (visible != null && (getComputedStyle(element).display !== 'none') !== visible) return;
        observer.disconnect();
        clearTimeout(timeout);
        resolve(element);
      }
      observer.observe(document, { subtree: true, childList: true, attributes: true });
      check();
    });
  }

  const docs = '[id="docs/readme.md"]';
  const docsVisible = (visible: boolean) =>
    Promise.all([waitFor(docs, visible), waitFor('#diff-viewed', visible)]);
  const menu = '[data-diffseek="filters"]';
  await waitFor('style#diffseek-filter-style');
  await waitFor(`${docs} [data-diffseek-viewed-action]`);
  await docsVisible(false);
  (await waitFor('button[aria-label="Filter options"]')).click();
  (await waitFor(`${menu} [data-filter-kind="viewed"][data-filter-value="true"]`)).click();
  await docsVisible(true);
  (await waitFor(`${menu} [data-filter-kind="groups"][data-filter-value="Docs"]`)).click();
  await docsVisible(false);
  await waitFor('[id="src/app.ts"]', true);
  await waitFor('#diff-app', true);
}

async function smoke(socket: WebSocket, archive: string, html: string, signal: AbortSignal): Promise<void> {
  let connected = false;
  let id = 0;
  const pending = new Map<number, (reply: Reply) => void>();
  const failure = Promise.withResolvers<never>();
  const abort = () => failure.reject(new Error('Firefox package smoke timed out'));
  const disconnect = () => failure.reject(new Error(connected
    ? 'Firefox WebDriver BiDi disconnected'
    : `Firefox WebDriver BiDi connection failed at ${socket.url}`));
  signal.addEventListener('abort', abort, { once: true });
  socket.addEventListener('error', disconnect);
  socket.addEventListener('close', disconnect);

  async function send<T = unknown>(method: string, params: object): Promise<T> {
    const command = ++id;
    const reply = new Promise<Reply>((resolve) => pending.set(command, resolve));
    socket.send(JSON.stringify({ id: command, method, params }));
    const message = await reply;
    if (message.type === 'error') throw new Error(`${method}: ${message.error}: ${message.message}`);
    return message.result as T;
  }

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data)) as Reply | BlockedRequest;
    if (message.type !== 'event') {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
      void send('network.provideResponse', {
        request: message.params.request.request,
        statusCode: 200,
        headers: [{ name: 'content-type', value: { type: 'string', value: 'text/html; charset=utf-8' } }],
        body: { type: 'string', value: html },
      }).catch(failure.reject);
    }
  });

  try {
    await Promise.race([exercise(), failure.promise]);
  } finally {
    signal.removeEventListener('abort', abort);
    socket.removeEventListener('error', disconnect);
    socket.removeEventListener('close', disconnect);
  }

  async function exercise() {
    await once(socket, 'open', { signal });
    connected = true;

    // Only the recorded page is served. Unmatched HTTP(S) requests fail locally.
    const proxy = '127.0.0.1:1';
    await send('session.new', {
      capabilities: { alwaysMatch: { proxy: { proxyType: 'manual', httpProxy: proxy, sslProxy: proxy } } },
    });
    const { extension } = await send<{ extension: string }>('webExtension.install', {
      extensionData: { type: 'archivePath', path: archive },
    });
    assert.equal(extension, geckoId);

    await send('session.subscribe', { events: ['network.beforeRequestSent'] });
    await send('network.addIntercept', {
      phases: ['beforeRequestSent'],
      urlPatterns: [{ type: 'string', pattern: pullUrl }],
    });
    const { contexts: [page] } = await send<{ contexts: { context: string }[] }>('browsingContext.getTree', {});
    assert.ok(page, 'Firefox did not open a tab');
    await send('browsingContext.navigate', { context: page.context, url: pullUrl, wait: 'complete' });

    const result = await send<{ type: string; exceptionDetails?: { text: string } }>('script.evaluate', {
      expression: `(${runReview.toString()})()`,
      target: { context: page.context },
      awaitPromise: true,
    });
    assert.equal(result.type, 'success', result.exceptionDetails?.text ?? 'Firefox fixture failed');
    await send('browser.close', {});
  }
}

const archive = await validatePackage();
const html = await readFile(
  join(root, 'src/adapters/github/review-page/fixtures/github-pr.html'),
  'utf8',
);
const profile = await mkdtemp(join(tmpdir(), 'diffseek-firefox-'));
try {
  // Firefox on a cold runner can spend most of a minute before BiDi listens.
  const signal = AbortSignal.timeout(90_000);
  const firefox = spawn(
    'firefox',
    ['--headless', '--profile', profile, '--remote-debugging-port', '0'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const closed = new Promise<void>((resolve) => firefox.once('close', resolve));
  const shutdown = once(firefox, 'close', { signal });
  void shutdown.catch(() => {});
  try {
    await once(firefox, 'spawn', { signal });
    const url = await debuggerUrl(firefox.stderr, signal);
    const socket = new WebSocket(url);
    try {
      await smoke(socket, archive, html, signal);
    } finally {
      socket.close();
    }
    await shutdown;
    assert.equal(firefox.exitCode, 0, 'Firefox exited unsuccessfully');
  } finally {
    firefox.kill('SIGKILL');
    firefox.stderr.destroy();
    await closed;
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}
console.log('Firefox package smoke passed');
