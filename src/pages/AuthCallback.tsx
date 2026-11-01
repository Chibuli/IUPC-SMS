import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '../session'
import { initialAuthCallback, readAuthCallbackIntent } from '../lib/auth-callback'
import Login from './Login'

export default function AuthCallback() {
  const { authReady, authLinkError, hasAuthSession, sessionReady, session, passwordSetupRequired } = useSession()
  const location = useLocation()
  if (!authReady) return null
  if (authLinkError || initialAuthCallback.error || readAuthCallbackIntent(location.search, location.hash).error || !hasAuthSession) {
    return <Login initialError="This sign-in link is invalid or expired. Request a new invitation or recovery email." />
  }
  // Password setup uses the Auth session, not cached school membership. The
  // existing form is mounted above all routes, including authenticated pages.
  if (passwordSetupRequired) return <Login />
  if (!sessionReady) return null
  return session ? <Navigate to="/dashboard" replace /> : <Login initialError="This account is not linked to an active school. Contact the administrator." />
}
