import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import PortalApp from './portal/PortalApp.jsx';
import './styles.css';

// Mismo proyecto, dos pantallas: la consola del equipo (/) y el portal del cliente (/portal).
const isPortal = window.location.pathname.startsWith('/portal');
if (isPortal) document.title = 'Nexo Solar: energía solar para tu negocio';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isPortal ? <PortalApp /> : <App />}
  </React.StrictMode>,
);
