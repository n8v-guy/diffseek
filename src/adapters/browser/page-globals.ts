/** Properties the extension and its tests install on the page. */
export interface ExtensionStorageLocal {
  clear: () => Promise<void>;
  get: (name: string) => Promise<unknown>;
  remove: (name: string) => Promise<void>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

declare global {
  var chrome: { storage: { local: ExtensionStorageLocal } };
  var recollapsed: Promise<void>;
  var renderScene: (scene: unknown) => void;

  var __liveCheckDom: (condition: unknown) => unknown;
  var __liveCheckReview: (condition: unknown) => unknown;
  var __liveFilterButton: () => HTMLButtonElement | null;
  var __liveInteractive: (button: HTMLButtonElement) => boolean;
  var __liveLinkPrefix: (prefix: string) => boolean;
  var __liveMenuState: () => '' | 'open' | 'replaced';
  var __liveObserve: (test: () => unknown) => Promise<unknown>;
  var __liveTagFilterButton: () => void;
  var __liveTextMatches: (selector: string, pattern: string) => boolean;
  var __liveUnviewedRow: () => boolean;
  var __liveVisible: (element: Element | null) => boolean;
  var __liveWait: (condition: unknown) => Promise<unknown>;
  var __liveWaitElement: (
    element: Element,
    name: string,
    value: string,
  ) => Promise<unknown>;
}
