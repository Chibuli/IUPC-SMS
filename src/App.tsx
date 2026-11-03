import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import AppLayout from './AppLayout'
import { useSession } from './session'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Classes from './pages/Classes'
import Teachers from './pages/Teachers'
import Timetable from './pages/Timetable'
import Subjects from './pages/Subjects'
import Terms from './pages/Terms'
import MarksEntry from './pages/MarksEntry'
import Exams from './pages/Exams'
import Analysis from './pages/Analysis'
import Reports from './pages/Reports'
import ReportCards from './pages/ReportCards'
import Settings from './pages/Settings'
import AuthCallback from './pages/AuthCallback'
import { PasswordRecoveryForm } from './components/BackendSetup'

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, sessionReady } = useSession()
  const location = useLocation()
  if (!sessionReady) return null
  if (!session) return <Navigate to="/" state={{ from: location }} replace />
  return <>{children}</>
}

export default function App() {
  const { session } = useSession()
  const navigate = useNavigate()
  return (
    <>
    <Routes>
      <Route path="/" element={session ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:studentId" element={<Students />} />
        <Route path="classes" element={<Classes />} />
        <Route path="teachers" element={<Teachers />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="subjects" element={<Subjects />} />
        <Route path="terms" element={<Terms />} />
        <Route path="marks-entry" element={<MarksEntry />} />
        <Route path="analysis" element={<Analysis />} />
        {/* The Examinations page manages every paper's lifecycle; a link to a
            single paper still opens that paper's register. */}
        <Route path="exams" element={<Exams />} />
        <Route path="exams/:examId/entry" element={<MarksEntry />} />
        <Route path="reports" element={<Reports />} />
        <Route path="report-cards" element={<ReportCards />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <PasswordRecoveryForm onDone={() => navigate('/', { replace: true })} />
    </>
  )
}
