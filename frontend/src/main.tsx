import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/app.css';
import './modules/machine-library/measurementInspectionLogsDomPatch';
import './modules/machine-library/measurementInspectionLogsEnhancements';
import './modules/machine-library/measurementInspectionPrintOverride';
import './modules/machine-library/measurementInspectionUiRefinement';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
