import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { MascotProvider } from './mascot';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MascotProvider avoidRight={window.innerWidth < 640 ? 8 : 170}>
      <App />
    </MascotProvider>
  </React.StrictMode>
);