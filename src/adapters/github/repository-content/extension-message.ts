import { browser } from 'wxt/browser';

/** Failure guard: a service worker that never answers must not pin the review. */
export const extensionMessageTimeoutMs = 20_000;

export function sendExtensionMessage<Result>(message: object): Promise<Result> {
  return withTimeout(browser.runtime.sendMessage<object, Result>(message));
}

function withTimeout<Result>(pending: Promise<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Extension message timed out'));
    }, extensionMessageTimeoutMs);
    pending.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('Extension message failed'));
      },
    );
  });
}
