import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import StoryApp from './story/StoryApp.jsx';
import './styles.css';

// The guided replays are the front page; the full workspace (live system) lives at #/workspace.
function route() {
  return (window.location.hash || '#/').replace(/^#\/?/, '');
}

function Root() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const on = () => { setR(route()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (r.startsWith('workspace')) return <App onStories={() => { window.location.hash = '#/'; }} />;
  return <StoryApp route={r} />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
