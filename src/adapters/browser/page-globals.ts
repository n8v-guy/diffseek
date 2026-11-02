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

  var __liveTagFilterButton: () => void;
  var __liveWait: (condition: unknown) => Promise<unknown>;
  var __liveWaitElement: (
    element: Element,
    name: string,
    value: string,
  ) => Promise<unknown>;
}
