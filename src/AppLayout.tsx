import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileCheck2,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Table2,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useDb } from './data/db'
import { useSession } from './session'
import { SyncPill } from './components/SyncStatus'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  adminOnly?: boolean
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Main', items: [{ to: '/dashboard', label: 'Overview', icon: LayoutDashboard }] },
  {
    title: 'Academic Community',
    items: [
      { to: '/dashboard/students', label: 'Students', icon: Users },
      { to: '/dashboard/classes', label: 'Classes', icon: GraduationCap },
      { to: '/dashboard/teachers', label: 'Teachers', icon: UserCog },
      { to: '/dashboard/timetable', label: 'Timetable', icon: CalendarDays },
      { to: '/dashboard/subjects', label: 'Subjects', icon: BookOpen },
    ],
  },
  {
    title: 'Assessment Engine',
    items: [
      { to: '/dashboard/terms', label: 'Terms', icon: ClipboardList },
      { to: '/dashboard/exams', label: 'Examinations', icon: FileCheck2 },
      { to: '/dashboard/marks-entry', label: 'Marks Entry', icon: FileText },
      { to: '/dashboard/analysis', label: 'Analysis', icon: TrendingUp },
      { to: '/dashboard/reports', label: 'Broadsheets', icon: Table2 },
      { to: '/dashboard/report-cards', label: 'Report Cards', icon: BarChart3 },
    ],
  },
  { title: 'System', items: [{ to: '/dashboard/settings', label: 'Settings', icon: Settings, adminOnly: true }] },
]

function roleBadge(role: string) {
  if (role === 'admin') return 'border-white/40 bg-white/15 text-white'
  if (role === 'teacher') return 'border-white/30 bg-white/10 text-white'
  return 'border-white/30 text-white'
}

export default function AppLayout() {
  const db = useDb()
  const { session, signOut } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const desktopNavRef = useRef<HTMLElement>(null)
  const school = db.schools[0] ?? { _id: 'school-unconfigured', name: 'IUPC Academy', code: '', address: '', postal: '', city: '', contact_email: '', phone_number: '', logo_url: null, crest_url: null, motto: '' }
  const wide = location.pathname.startsWith('/dashboard/timetable')
  useEffect(() => {
    if (window.innerWidth >= 1024) desktopNavRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [location.pathname])
  useEffect(() => {
    if (!drawer) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const closeOnDesktop = () => { if (window.innerWidth >= 1024) setDrawer(false) }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawer(false) }
      if (event.key !== 'Tab') return
      const controls = [...(drawerRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') ?? [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeOnDesktop)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeOnDesktop)
      menuRef.current?.focus()
    }
  }, [drawer])

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || session?.role === 'admin'),
  })).filter((group) => group.items.length > 0)

  const signOutNow = () => {
    signOut()
    navigate('/')
  }

  /** Vertical, grouped navigation for the mobile drawer. */
  const drawerNav = (
    <nav aria-label="Primary mobile" className="workspace-drawer-nav min-h-0 flex-1 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.title} className="mb-4">
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
            {group.title}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/dashboard'}
                  onClick={() => setDrawer(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded px-2 py-1.5 text-[13px] transition ${
                      isActive ? 'bg-crimson font-medium text-white' : 'text-white/70 hover:bg-white/8 hover:text-white'
                    }`
                  }
                >
                  <item.icon size={15} />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )

  const drawerAccount = (
    <div className="shrink-0 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <p className="text-[13px] font-medium text-white">{session?.name}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${roleBadge(session?.role ?? 'guest')}`}>
          {session?.role ?? 'guest'}
        </span>
        <button
          type="button"
          onClick={signOutNow}
          className="inline-flex items-center gap-1 text-[11px] text-white/50 transition hover:text-white"
        >
          <LogOut size={12} /> Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="workspace-shell min-h-screen bg-paper print:min-h-0">
      <a href="#workspace-main" className="workspace-skip-link">Skip to main content</a>
      {/* ── mobile bar ─────────────────────────────────────────────── */}
      <header className="workspace-mobile-header sticky top-0 z-40 no-print">
        <div className="workspace-mobile-top">
        <button ref={menuRef} type="button" className="workspace-header-button" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-expanded={drawer} aria-controls="workspace-navigation">
          <Menu size={15} />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <img className="workspace-logo" src={school.logo_url || '/iupc-wordmark.png'} alt={`${school.name} logo`} width="174" height="71" />
          <div className="min-w-0"><p className="truncate text-[13px] font-semibold">{school.name}</p><p className="workspace-subtitle">Academic Workspace</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <SyncPill surface="dark" compact />
          <button type="button" className="workspace-header-button" onClick={signOutNow} aria-label="Sign out">
            <LogOut size={14} />
          </button>
        </div>
        </div>
        <div className="workspace-mobile-account">
          <span className="truncate" title={session?.name}>{session?.name}</span>
          <span className={`workspace-role ${roleBadge(session?.role ?? 'guest')}`}>{session?.role ?? 'guest'}</span>
          {session?.role === 'admin' ? <Link className="workspace-register" to="/dashboard/teachers?register=1"><UserPlus size={14} aria-hidden="true" /> Register teacher</Link> : null}
        </div>
      </header>

      {/* ── desktop top bar ────────────────────────────────────────── */}
      {/* The menu sits above every page rather than beside it, so a page owns the
          full window width: the timetable needs that for forty period columns. */}
      <header className="workspace-header sticky top-0 z-40 text-white no-print">
        <div className="workspace-header-top mx-auto flex max-w-[1600px] items-center gap-4 px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <img className="workspace-logo" src={school.logo_url || '/iupc-wordmark.png'} alt={`${school.name} logo`} width="174" height="71" />
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold leading-tight">{school.name}</p>
              <p className="workspace-subtitle">Academic Workspace</p>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            <SyncPill surface="dark" />
            {session?.role === 'admin' ? (
              <Link
                to="/dashboard/teachers?register=1"
                title="Register a teacher"
                className="workspace-register"
              >
                <UserPlus size={13} /> Register teacher
              </Link>
            ) : null}
            <p className="workspace-user" title={session?.name}>{session?.name}</p>
            <span
              className={`workspace-role ${roleBadge(session?.role ?? 'guest')}`}
            >
              {session?.role ?? 'guest'}
            </span>
            <span className="h-4 w-px bg-white/15" aria-hidden="true" />
            <button
              type="button"
              onClick={signOutNow}
              className="workspace-header-button"
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>

        <div className="border-t border-white/10">
          <nav
            ref={desktopNavRef}
            aria-label="Primary"
            className="workspace-nav mx-auto flex max-w-[1600px] items-center gap-x-1 px-4 py-1.5 xl:px-8"
          >
            {groups.map((group, index) => (
              <div key={group.title} className="flex shrink-0 items-center">
                {index > 0 ? <span className="mx-2 h-4 w-px shrink-0 bg-white/15" aria-hidden="true" /> : null}
                <ul className="flex items-center gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/dashboard'}
                        title={`${group.title} · ${item.label}`}
                        className={({ isActive }) => `workspace-nav-link ${isActive ? 'is-active' : ''}`}
                      >
                        <item.icon size={15} />
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </header>

      {drawer ? (
        <div className="workspace-drawer fixed inset-0 z-50 no-print">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div ref={drawerRef} id="workspace-navigation" role="dialog" aria-modal="true" aria-label="Workspace navigation" className="workspace-drawer-panel absolute inset-y-0 left-0 flex flex-col">
            <div className="flex items-center justify-between px-3 pt-3 pb-1">
              <div className="flex items-center gap-2 px-1">
                <img className="workspace-logo" src={school.logo_url || '/iupc-wordmark.png'} alt={`${school.name} logo`} width="174" height="71" />
                <span className="text-[13px] font-semibold text-white">{school.name}</span>
              </div>
              <button type="button" className="workspace-header-button" onClick={() => setDrawer(false)} aria-label="Close navigation">
                <X size={18} />
              </button>
            </div>
            {session?.role === 'admin' ? <Link to="/dashboard/teachers?register=1" onClick={() => setDrawer(false)} className="workspace-register mx-4 mt-3"><UserPlus size={14} /> Register teacher</Link> : null}
            {drawerNav}
            {drawerAccount}
          </div>
        </div>
      ) : null}

      {/* The timetable is a week-wide wall chart: capping it at the reading
          column would force forty period columns back into a scroller. */}
      <main
        id="workspace-main"
        tabIndex={-1}
        className={`workspace-content mx-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 md:px-6 md:py-6 xl:px-8 print:max-w-none print:p-0 ${
          wide ? 'max-w-none 2xl:max-w-[1600px]' : 'max-w-6xl'
        }`}
      >
        <Outlet />
      </main>
    </div>
  )
}
