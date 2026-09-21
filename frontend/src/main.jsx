import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import { BASE_DOMAIN } from './context/entry-context';
import './index.css';

// CDN/reverse proxy should also issue this canonical redirect (308).
if (window.location.hostname.toLowerCase() === `www.${BASE_DOMAIN}`) {
  const canonical = new URL(window.location.href);
  canonical.hostname = BASE_DOMAIN;
  window.location.replace(canonical.href);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
