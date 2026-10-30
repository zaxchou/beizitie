import React from 'react';
import { createRoot } from 'react-dom/client';
import TieyeApp from './TieyeApp';
import './tieye.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><TieyeApp /></React.StrictMode>,
);
