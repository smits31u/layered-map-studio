import React from 'react';import{createRoot}from'react-dom/client';import App from './App';import './styles.css';import './styles/tokens.css';import './styles/studio.css';import {applyTheme,resolveTheme} from './theme/theme';
// Before the first render, so the page never paints in the wrong theme and then flips.
applyTheme(resolveTheme());
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
