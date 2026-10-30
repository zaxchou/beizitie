import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import AppRoot from '@app/root';
import { installMiniCompat } from './mini-compat';

if (__MINI__) installMiniCompat();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
);
