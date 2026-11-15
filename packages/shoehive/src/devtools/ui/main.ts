// Entry point of the inspector bundle (scripts/build-devtools-ui.mjs builds it into
// app.js). Reads the token, then mounts the app.

import { h, render } from 'preact';
import { App } from './app';
import { hashForPage, pageFromHash, socketUrl, takeToken } from './location';
import type { Page } from './state';

function mount(): void {
  const root = document.getElementById('app');
  if (root === null) return;
  const token = takeToken(window.location, window.history);
  const initialPage = pageFromHash(window.location.hash);
  const onPage = (page: Page): void => {
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${search}${hashForPage(page)}`,
    );
  };
  root.textContent = '';
  render(h(App, { url: socketUrl(window.location), token, initialPage, onPage }), root);
}

mount();
