import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/manrope';
import App from './App';
import './styles/tokens.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
