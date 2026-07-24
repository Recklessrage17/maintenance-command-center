import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/mcc-tokens.css';
import './styles/app.css';
import './styles/glass-system.css';
import './styles/mcc-industrial-primitives.css';
// Module migration styles load here, after the shared industrial primitives.

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
