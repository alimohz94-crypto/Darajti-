import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { purgeAdminAndSensitiveOfflineCaches } from './utils/offlineStore';

// Purge any legacy or accidental admin / pending / rejected offline caches immediately
purgeAdminAndSensitiveOfflineCaches();

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW() {
      purgeAdminAndSensitiveOfflineCaches();
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
