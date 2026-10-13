/// <reference lib="webworker" />
import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Scope isolates this app from other projects hosted on the same Pages origin.
setCacheNameDetails({ prefix: 'ecole-app', suffix: self.registration.scope });
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

const appBase = new URL(self.registration.scope).pathname;
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${appBase}index.html`), {
    denylist: [/\/content\//],
  }),
);

// No automatic skipWaiting: updates wait for a deliberate, guarded action.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
