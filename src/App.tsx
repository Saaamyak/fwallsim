import { useEffect, useRef } from 'react';
import { gobj } from './engine/config';
import { getState, logout, needsSetup, tick, useStore } from './store';
import { Login, ChangePassword, Booting, Setup, Welcome } from './gui/Login';
import { Layout } from './gui/Layout';

export default function App() {
  const auth = useStore((s) => s.auth);
  const booting = useStore((s) => s.booting);
  const welcomed = useStore((s) => s.welcomed);
  const fresh = useStore((s) => needsSetup(s.config));
  const theme = useStore((s) => gobj(s.config, 'system global', 'gui-theme'));
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const touch = () => (lastActivity.current = Date.now());
    window.addEventListener('mousedown', touch);
    window.addEventListener('keydown', touch);
    const t = setInterval(() => {
      tick();
      // Idle timeout, like "set admintimeout" on a real unit
      const s = getState();
      const mins = Number(gobj(s.config, 'system global', 'admintimeout')) || 5;
      if (s.auth.loggedIn && Date.now() - lastActivity.current > mins * 60_000) logout(`timed out after ${mins} minutes idle`);
    }, 3000);
    return () => {
      clearInterval(t);
      window.removeEventListener('mousedown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, []);

  if (booting) return <Booting />;
  if (!auth.loggedIn && fresh) return welcomed ? <Setup /> : <Welcome />;
  if (!auth.loggedIn) return <Login />;
  if (auth.mustChange) return <ChangePassword />;
  return <Layout />;
}
