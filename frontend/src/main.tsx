import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/mcc-tokens.css';
import './styles/app.css';
import './styles/glass-system.css';
import './styles/mcc-industrial-primitives.css';
import './styles/mcc-industrial-modules.css';
import './styles/mcc-login.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
