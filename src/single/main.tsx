import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import AppRoot from '@app/root';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
);
