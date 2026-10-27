import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { SessionProvider } from './session'
import { watchConnection } from './lib/offline'
import './index.css'

/**
 * The service worker is for the browser-installed app, where the shell has to be
 * cached against a network that comes and goes. Inside the Android shell the
 * assets already ship in the APK, so a worker there would only serve a second
 * copy of them and risk serving a stale one after an app update.
 */
function inNativeShell() {
  const capacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return Boolean(capacitor?.isNativePlatform?.())
}

if (import.meta.env.PROD && !inNativeShell()) registerSW({ immediate: true })
watchConnection()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
