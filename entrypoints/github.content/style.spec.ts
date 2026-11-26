import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'style.css'),
  'utf8',
);

const lightBackground = 'rgb(240, 237, 255)';
const lightColor = 'rgb(59, 46, 131)';
const darkBackground = 'rgb(43, 33, 70)';
const darkColor = 'rgb(230, 220, 255)';

const themeCases = [
  {
    name: 'light mode',
    colorMode: 'light',
    lightTheme: 'light',
    darkTheme: 'dark',
    colorScheme: 'dark',
    background: lightBackground,
    color: lightColor,
  },
  {
    name: 'dark mode',
    colorMode: 'dark',
    lightTheme: 'light',
    darkTheme: 'dark',
    colorScheme: 'light',
    background: darkBackground,
    color: darkColor,
  },
  {
    name: 'auto+OS light with light day theme',
    colorMode: 'auto',
    lightTheme: 'light',
    darkTheme: 'dark',
    colorScheme: 'light',
    background: lightBackground,
    color: lightColor,
  },
  {
    name: 'auto+OS dark with light night theme',
    colorMode: 'auto',
    lightTheme: 'light',
    darkTheme: 'light_high_contrast',
    colorScheme: 'dark',
    background: lightBackground,
    color: lightColor,
  },
  {
    name: 'auto+OS dark with dark night theme',
    colorMode: 'auto',
    lightTheme: 'light',
    darkTheme: 'dark_dimmed',
    colorScheme: 'dark',
    background: darkBackground,
    color: darkColor,
  },
  {
    name: 'auto+OS light with dark day theme',
    colorMode: 'auto',
    lightTheme: 'dark_dimmed',
    darkTheme: 'dark',
    colorScheme: 'light',
    background: darkBackground,
    color: darkColor,
  },
  {
    name: 'dark mode without a night theme falls back to light',
    colorMode: 'dark',
    lightTheme: null,
    darkTheme: null,
    colorScheme: 'dark',
    background: lightBackground,
    color: lightColor,
  },
  {
    name: 'auto+OS dark without a night theme falls back to light',
    colorMode: 'auto',
    lightTheme: 'light',
    darkTheme: null,
    colorScheme: 'dark',
    background: lightBackground,
    color: lightColor,
  },
] as const;

describe('DiffSeek Reset without CSS anchor positioning', () => {
  const fallback = /@supports not \(left: anchor\(right\)\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

  it('offsets the menu icon from the menu corner and hides the button icon', () => {
    expect(fallback).toContain("button.diffseek-reset-filters[data-reset-filters] {\n    position: absolute;");
    expect(fallback).toMatch(/\n {4}right: [^;]+;\n {4}top: [^;]+;/);
    expect(fallback).toContain("[data-diffseek='filter-button-reset'] {\n    display: none !important;");
    expect(fallback).not.toContain('anchor(');
  });

  it('leaves the anchored layout outside the fallback', () => {
    const anchored = css.replace(fallback, '');
    expect(anchored).toContain('left: anchor(right);');
    expect(anchored).toContain('top: calc(anchor(top) - 0.75rem);');
  });
});

describe('DiffSeek palette follows GitHub theme attributes', () => {
  it.each(themeCases)('$name', (theme) => {
    const { background, color } = appliedPalette(theme);
    expect(background).toBe(theme.background);
    expect(color).toBe(theme.color);
  });
});

function appliedPalette(theme: (typeof themeCases)[number]): {
  background: string;
  color: string;
} {
  const root = document.documentElement;
  root.setAttribute('data-color-mode', theme.colorMode);
  setThemeAttribute(root, 'data-light-theme', theme.lightTheme);
  setThemeAttribute(root, 'data-dark-theme', theme.darkTheme);
  document.head.replaceChildren();
  document.body.replaceChildren();

  const style = document.createElement('style');
  style.textContent = cssForColorScheme(css, theme.colorScheme);
  document.head.append(style);
  const probe = document.createElement('div');
  probe.setAttribute('data-diffseek', 'filters');
  document.body.append(probe);

  const computed = getComputedStyle(probe);
  return { background: computed.backgroundColor, color: computed.color };
}


function setThemeAttribute(
  root: HTMLElement,
  name: 'data-light-theme' | 'data-dark-theme',
  value: string | null,
): void {
  if (value == null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

function cssForColorScheme(source: string, scheme: 'light' | 'dark'): string {
  const style = document.createElement('style');
  style.textContent = source;
  document.head.append(style);
  const rules = style.sheet?.cssRules;
  if (!rules) throw new Error('Failed to parse DiffSeek theme CSS');

  const parts: string[] = [];
  const media = `(prefers-color-scheme: ${scheme})`;
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule) {
      if (rule.media.mediaText === media) {
        for (const inner of Array.from(rule.cssRules)) parts.push(inner.cssText);
      }
      continue;
    }
    parts.push(rule.cssText);
  }
  style.remove();
  return parts.join('\n');
}
