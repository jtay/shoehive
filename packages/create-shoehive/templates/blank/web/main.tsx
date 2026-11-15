import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShoehiveProvider } from 'shoehive/react';
import { App } from './App';

// The socket is on the page's own origin: src/server.ts serves both after a build, and in
// development the Vite dev server proxies /shoehive to it (see vite.config.ts).
const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/shoehive`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShoehiveProvider url={url}>
      <App />
    </ShoehiveProvider>
  </StrictMode>,
);
