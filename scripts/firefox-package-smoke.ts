import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as unknown;
assert.ok(typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string');
const { stdout } = await exec('git', ['rev-list', '--count', 'HEAD'], { cwd: root });
const [major = '0', minor = '0'] = pkg.version.split('.');
const expected = `${major}.${minor}.${stdout.trim()}`;
const zipFiles = (await readdir(resolve(root, '.output'))).filter((name) => name.endsWith('-firefox.zip'));
assert.equal(zipFiles.length, 1, 'Expected exactly one Firefox ZIP');
const zipFile = zipFiles[0];
assert.ok(zipFile !== undefined);
const archive = resolve(root, '.output', zipFile);
const { stdout: manifestText } = await exec('unzip', ['-p', archive, 'manifest.json']);
const manifest = JSON.parse(manifestText) as unknown;
assert.ok(typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string' && 'manifest_version' in manifest && 'browser_specific_settings' in manifest);
const gecko = manifest.browser_specific_settings as { gecko: { id: string } };
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, expected, 'Manifest version must match full git history');
assert.equal(gecko.gecko.id, 'diffseek@n8v.me');
await exec('unzip', ['-t', archive]);

const fixture = await readFile(resolve(root, 'src/adapters/github/review-page/fixtures/github-pr.html'), 'utf8');
const instrumented = fixture.replace('<ul role="tree" aria-label="File Tree">', `<ul role="tree" aria-label="File Tree">
<li id="src" role="treeitem" aria-label="src"><div>src</div></li>
<li id="docs" role="treeitem" aria-label="docs"><div>docs</div></li>`)
;

const port = await new Promise<number>((ok, fail) => {
 const server = createServer();
 server.once('error', fail);
 server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') return fail(new Error('Missing port'));
  const allocatedPort = address.port;
  server.close(() => ok(allocatedPort));
 });
});
const driver = spawn('geckodriver', ['--port', String(port)], { stdio: 'pipe' });
let session = '';
const endpoint = `http://127.0.0.1:${port}`;
async function request(method: string, path: string, body?: unknown) {
 const response = await fetch(endpoint + path, {
  method, headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
 });
 const result = await response.json() as { value: unknown };
 if (!response.ok) throw new Error(`WebDriver ${method} ${path}: ${JSON.stringify(result)}`);
 return result.value;
}
async function until<T>(action: () => Promise<T | false>, message: string): Promise<T> {
 for (let i = 0; i < 60; i++) {
  try { const result = await action(); if (result !== false) return result; } catch { /* retry */ }
  await delay(500);
 }
 const diagnostics = session ? await execute('return {url: location.href, title: document.title, tree: !!document.querySelector(\'[role="tree"]\'), actions: document.querySelectorAll("[data-diffseek-viewed-action]").length, filters: document.querySelectorAll("[data-diffseek]").length, body: document.body?.innerText?.slice(0, 300)};').catch(() => null) : null;
 throw new Error(`${message}: ${JSON.stringify(diagnostics)}`);
}
async function execute(script: string, args: unknown[] = []) {
 return request('POST', `/session/${session}/execute/sync`, { script, args });
}
try {
 await until(async () => {
  try { await fetch(endpoint + '/status'); return true; } catch { return false; }
 }, 'geckodriver did not start');
 const created = await request('POST', '/session', {
  capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } },
 }) as { sessionId: string };
 session = created.sessionId;
 const zip = await readFile(archive);
 await request('POST', `/session/${session}/moz/addon/install`, {
  addon: zip.toString('base64'), temporary: true,
 });
 // The fixture is the same recorded GitHub markup used by Chromium tests.
 // Navigate to the permitted origin, then replace the page with the fixture.
 await request('POST', `/session/${session}/url`, {
  url: 'https://github.com/microsoft/vscode/pull/1/changes',
 });
 await execute('history.pushState({}, "", "/octo/repo/pull/8/changes"); document.body.innerHTML = arguments[0]; document.dispatchEvent(new Event("turbo:load"));', [instrumented.split('<body>')[1]?.split('</body>')[0] ?? instrumented]);
 await until(async () => await execute(
  'return document.querySelectorAll("[data-diffseek-viewed-action]").length >= 7;',
 ) === true, 'Packaged Firefox extension did not initialize on fixture');
 await execute(`document.querySelector('[aria-label="Filter options"]').click(); document.body.insertAdjacentHTML('beforeend', '<ul role="menu" aria-label="Filter options"></ul>');`);
 await until(async () => await execute(
  'return !!document.querySelector(\'[data-diffseek="filters"]\');',
 ) === true, 'Firefox filter menu did not render');
 await execute(`document.querySelector('[data-filter-kind="groups"][data-filter-value="Docs"]').click();`);
 await until(async () => await execute(
  'return document.getElementById("docs/readme.md")?.hidden === true;',
 ) === true, 'Docs filter did not hide the fixture file');
 console.log('Firefox package smoke passed:', manifest.version);
} finally {
 if (session) await request('DELETE', `/session/${session}`).catch(() => {});
 driver.kill();
}
