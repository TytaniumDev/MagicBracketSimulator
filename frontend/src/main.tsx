import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { loadRuntimeConfig } from './config';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import './index.css';

// Load runtime config (e.g. /config.json) so API URLs come from there instead of .env
loadRuntimeConfig().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>
  );
});
