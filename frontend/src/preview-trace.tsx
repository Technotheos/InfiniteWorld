// Dev-only: renders the Trace Lab on its own, with no login and no server (the desk line will just say it cannot connect).
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { TraceLab } from './trace-lab';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <TraceLab username="neo" token="preview" onLeave={() => undefined} />,
);
