import { type PageSnapshot, scanPage } from './page-adapter';

export function parseFragment(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  for (const node of parsed.body.childNodes) {
    fragment.append(document.importNode(node, true));
  }
  return fragment;
}

export function replaceBody(html: string): void {
  document.body.replaceChildren(parseFragment(html));
}

export function replaceDocument(html: string, root = document): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  root.documentElement.replaceWith(
    root.importNode(parsed.documentElement, true),
  );
}

export function requireSupported(
  root = document,
): Extract<PageSnapshot, { supported: true }> {
  const snapshot = scanPage(root);
  if (snapshot.supported) return snapshot;
  throw new Error(snapshot.reason);
}
