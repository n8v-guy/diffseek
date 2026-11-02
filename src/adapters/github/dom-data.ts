/** Dataset fields, addressed by the camelCase key `dataset` uses. The key stays
 * a variable so index-signature access and dot notation both accept it.
 */
export function clearDataAttribute(
  element: HTMLElement | SVGElement,
  name: string,
): void {
  element.removeAttribute(dataAttributeName(name));
}

export function dataAttribute(
  element: HTMLElement | null | SVGElement | undefined,
  name: string,
): string | undefined {
  if (element === null || element === undefined) return undefined;
  return element.dataset[name];
}

export function setDataAttribute(
  element: HTMLElement | SVGElement,
  name: string,
  value: string,
): void {
  element.dataset[name] = value;
}

function dataAttributeName(name: string): string {
  let kebab = '';
  for (const letter of name) {
    kebab += letter >= 'A' && letter <= 'Z' ? `-${letter.toLowerCase()}` : letter;
  }
  return `data-${kebab}`;
}
