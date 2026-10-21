import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { startLive } from './lib/live.ts';
import { setUpMusic } from './lib/music.ts';
import { registerWorker } from './lib/push.ts';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
startLive().catch((e) => console.error(e));
void registerWorker();
setUpMusic();
