import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Anonymous, cookie-free page-view counts on the hosted site only (Vercel Web Analytics); never in dev or tests. */}
    {import.meta.env.PROD && <Analytics />}
  </StrictMode>,
);
