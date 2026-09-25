import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import { AppThemeProvider } from './theme';
import { GOOGLE_CLIENT_ID } from './config';
import { installApostropheStraightener } from './utils/apostrophes';
import './index.css';

installApostropheStraightener();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppThemeProvider>
        <CssBaseline />
        <App />
      </AppThemeProvider>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
