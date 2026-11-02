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

export function replaceDocument(html: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.replaceWith(
    document.importNode(parsed.documentElement, true),
  );
}
