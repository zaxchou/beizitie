import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import SingleApp from './App';
import { installMiniCompat } from './mini-compat';

if (__MINI__) installMiniCompat();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SingleApp />
  </React.StrictMode>,
);
