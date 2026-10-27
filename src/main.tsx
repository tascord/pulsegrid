import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './theme/ThemeContext';
import { logger } from './audio/Logger';

logger.installConsoleHook();
logger.info('app', 'PulseGrid workstation started');

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
