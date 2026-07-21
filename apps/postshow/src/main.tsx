import React from 'react';
import ReactDOM from 'react-dom/client';
import { initAnalytics } from './lib/analytics';
import { captureInitialInvitationFragment } from './lib/invitationFragment';
import { Root } from './Root';
import './index.css';

captureInitialInvitationFragment();
initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
