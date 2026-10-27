import { useState, type ComponentType } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
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
import { SchoolCrest } from './components/ui'

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
      { to: '/dashboard/marks-entry', label: 'Marks Entry', icon: FileText },
      { to: '/dashboard/analysis', label: 'Analysis', icon: TrendingUp },
      { to: '/dashboard/reports', label: 'Broadsheets', icon: Table2 },
      { to: '/dashboard/report-cards', label: 'Report Cards', icon: BarChart3 },
    ],
  },
  { title: 'System', items: [{ to: '/dashboard/settings', label: 'Settings', icon: Settings, adminOnly: true }] },
]

function roleBadge(role: string) {
  if (role === 'admin') return 'border-brass/50 bg-brass/15 text-brass'
  if (role === 'teacher') return 'border-white/20 bg-white/10 text-white/80'
  return 'border-white/15 text-white/60'
}

export default function AppLayout() {
  const db = useDb()
  const { session, signOut } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const school = db.schools[0]
  const wide = location.pathname.startsWith('/dashboard/timetable')

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
    <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
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
    <div className="min-h-screen bg-paper print:min-h-0">
      {/* ── mobile bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-rule bg-raised px-4 py-2.5 md:hidden no-print">
        <button type="button" className="btn btn-sm" onClick={() => setDrawer(true)} aria-label="Open navigation">
          <Menu size={15} />
        </button>
        <div className="flex items-center gap-2">
          <SchoolCrest school={school} size={24} />
          <span className="text-[13px] font-semibold">{school.name}</span>
        </div>
        <button type="button" className="btn btn-sm" onClick={signOutNow} aria-label="Sign out">
          <LogOut size={14} />
        </button>
      </div>

      {/* ── desktop top bar ────────────────────────────────────────── */}
      {/* The menu sits above every page rather than beside it, so a page owns the
          full window width: the timetable needs that for forty period columns. */}
      <header className="sticky top-0 z-40 hidden bg-ink text-white shadow-[0_1px_0_rgb(255_255_255/0.06),0_10px_24px_-16px_rgb(17_24_39/0.55)] md:block no-print">
        <div className="mx-auto flex h-[56px] max-w-[1600px] items-center gap-4 px-6 xl:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <SchoolCrest school={school} size={30} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-tight">{school.name}</p>
              <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/40">Academic workspace</p>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2.5">
            {session?.role === 'admin' ? (
              <Link
                to="/dashboard/teachers?register=1"
                title="Register a teacher"
                className="inline-flex items-center gap-1.5 rounded border border-white/20 bg-white/10 px-2 py-1 text-[11.5px] font-medium text-white/85 transition hover:bg-white/20 hover:text-white"
              >
                <UserPlus size={13} /> Register teacher
              </Link>
            ) : null}
            <p className="max-w-[180px] truncate text-[12px] text-white/75">{session?.name}</p>
            <span
              className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] ${roleBadge(session?.role ?? 'guest')}`}
            >
              {session?.role ?? 'guest'}
            </span>
            <span className="h-4 w-px bg-white/15" aria-hidden="true" />
            <button
              type="button"
              onClick={signOutNow}
              className="inline-flex items-center gap-1 text-[11.5px] text-white/55 transition hover:text-white"
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>

        <div className="border-t border-white/10">
          <nav
            aria-label="Primary"
            className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-1 gap-y-0.5 px-4 py-1.5 xl:px-8"
          >
            {groups.map((group, index) => (
              <div key={group.title} className="flex items-center">
                {index > 0 ? <span className="mx-2 h-4 w-px shrink-0 bg-white/15" aria-hidden="true" /> : null}
                <ul className="flex items-center gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/dashboard'}
                        title={`${group.title} · ${item.label}`}
                        className={({ isActive }) =>
                          `flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-[12.5px] transition ${
                            isActive ? 'bg-crimson font-medium text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'
                          }`
                        }
                      >
                        <item.icon size={14} className="hidden xl:block" />
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
        <div className="fixed inset-0 z-50 md:hidden no-print">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 flex w-[268px] flex-col bg-ink">
            <div className="flex items-center justify-between px-3 pt-3 pb-1">
              <div className="flex items-center gap-2 px-1">
                <SchoolCrest school={school} size={26} />
                <span className="text-[13px] font-semibold text-white">{school.name}</span>
              </div>
              <button type="button" className="text-white/60" onClick={() => setDrawer(false)} aria-label="Close navigation">
                <X size={18} />
              </button>
            </div>
            {drawerNav}
            {drawerAccount}
          </div>
        </div>
      ) : null}

      {/* The timetable is a week-wide wall chart: capping it at the reading
          column would force forty period columns back into a scroller. */}
      <main
        className={`mx-auto px-4 py-6 md:px-6 md:py-6 xl:px-8 print:max-w-none print:p-0 ${
          wide ? 'max-w-none 2xl:max-w-[1600px]' : 'max-w-6xl'
        }`}
      >
        <Outlet />
      </main>
    </div>
  )
}
