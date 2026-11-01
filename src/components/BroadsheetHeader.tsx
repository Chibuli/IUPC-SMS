import type { School } from '../data/types'
import { SchoolLogo } from './ui'

const configured = (value: unknown): string => typeof value === 'string' && !/^(null|undefined)$/i.test(value.trim()) ? value.trim() : ''

/** Shared letterhead only; school settings and academic content remain authoritative. */
export function BroadsheetHeader({ school, title, detail }: { school: School; title: string; detail: string }) {
  const address = configured(school.address)
  const location = [configured(school.postal), configured(school.city)].filter(Boolean).join(' · ')
  const phone = configured(school.phone_number)
  const email = configured(school.contact_email)
  const testSchool = /fictional|test data|not school records|in-memory test fixture/i.test(address)
  const testEmail = testSchool || /\.(invalid|test)$/i.test(email)

  return <header className="broadsheet-letterhead">
    <div className="broadsheet-letterhead__logo"><SchoolLogo school={school} size={40} /></div>
    <div className="broadsheet-letterhead__school">
      <p className="broadsheet-letterhead__name">{configured(school.name)}</p>
      {address ? <p className={testSchool ? 'broadsheet-letterhead__warning' : undefined}>{address}</p> : null}
      {location ? <p>{location}</p> : null}
      {phone ? <p>{testSchool ? 'Test telephone (unverified)' : 'Tel'}: {phone}</p> : null}
      {email ? <p>{testEmail ? 'Test email (unverified)' : 'Email'}: {email}</p> : null}
    </div>
    <div className="broadsheet-letterhead__exam"><p>{title}</p><p>{detail}</p></div>
  </header>
}
