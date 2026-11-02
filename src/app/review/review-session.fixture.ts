export async function appendStreamRegions(start: number, end: number): Promise<void> {
  for (let index = start; index < end; index += 1) {
    const region = document.createElement('div');
    region.id = `diff-stream-${String(index)}`;
    region.setAttribute('role', 'region');
    document.body.append(region);
    await Promise.resolve();
  }
}

export function countFrames(): { stop: () => number } {
  let frames = 0;
  let live = true;
  const tick = (): void => {
    if (!live) return;
    frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: (): number => {
      live = false;
      return frames;
    },
  };
}

export async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export async function nextFrame(): Promise<void> {
  await flush();
  await new Promise<void>((resolve): void => {
    requestAnimationFrame((): void => { resolve(); });
  });
}

/** Lets observer callbacks queue their pass, then runs the next task. */
export async function nextTask(): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.addEventListener('message', (): void => {
      channel.port1.close();
      resolve();
    }, { once: true });
    channel.port1.start();
    channel.port2.postMessage(null);
  });
}

export function pageHtml(count: number): string {
  const rows = Array.from({ length: count }, (_item, index) => {
    const path = `src/file-${String(index)}.ts`;
    return `<li id="${path}" role="treeitem" aria-label="file-${String(index)}.ts"><div class="tree-item-visual" aria-hidden="true"><svg class="octicon octicon-file-diff"></svg></div><a href="#diff-file-${String(index)}">${path}</a></li>`;
  }).join('');
  return `<body><button aria-label="Filter options"></button><ul role="tree" aria-label="File Tree">${rows}</ul><div id="diff-host"></div></body>`;
}

export function regionNode(index: number): HTMLElement {
  const region = document.createElement('div');
  region.id = `diff-file-${String(index)}`;
  region.setAttribute('role', 'region');
  const parsed = new DOMParser().parseFromString(
    `<div data-diff-header-wrapper="true"><button aria-label="Collapse file"></button><h3><code>src/file-${String(index)}.ts</code></h3><button aria-label="Not Viewed" aria-pressed="false">Viewed</button></div>`,
    'text/html',
  );
  const header = parsed.body.firstElementChild;
  if (header !== null) region.append(document.importNode(header, true));
  return region;
}
