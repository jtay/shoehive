import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShoehiveProvider } from 'shoehive/react';
import { App } from './App';

// The page and the socket share an origin: src/server.ts serves both.
const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/shoehive`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShoehiveProvider url={url}>
      <App />
    </ShoehiveProvider>
  </StrictMode>,
);
