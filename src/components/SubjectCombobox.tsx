import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { Subject } from '../data/types'

/** Local presentation only: the parent retains the authoritative selection. */
export function SubjectCombobox({ subjects, selected, onSelect }: {
  subjects: Subject[]; selected?: Subject; onSelect: (id: string) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const matches = subjects.filter(subject => `${subject.name} ${subject.code} ${subject.category} ${subject.level}`.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  useEffect(() => {
    if (open) root.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active, query])
  const start = () => { setQuery(''); setActive(0); setOpen(true) }
  const choose = (subject: Subject) => { onSelect(subject._id); setOpen(false) }
  return <div className="marks-subject" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <label className="field-label" htmlFor={id}>Subject</label>
    <div className="marks-subject-input">
      <Search size={15} aria-hidden="true" />
      <input id={id} className="input-field" role="combobox" autoComplete="off"
        aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${id}-${matches[active]._id}` : undefined}
        aria-describedby={`${id}-hint`} data-field="subject-search"
        placeholder="Search subject or Cambridge code"
        value={open ? query : selected ? `${selected.name} · ${selected.code}` : ''}
        onClick={() => { if (!open) start() }}
        onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) start()
            else setActive(index => matches.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0)
          } else if (event.key === 'Enter' && open) {
            event.preventDefault(); if (matches[active]) choose(matches[active])
          }
        }} />
      <ChevronDown size={14} aria-hidden="true" />
    </div>
    <span id={`${id}-hint`} className="marks-subject-hint">{selected ? selected.level : 'Choose a subject to load its register'}</span>
    {open && <div className="marks-subject-popup">
      <div id={`${id}-options`} role="listbox" aria-label="Subjects" data-subject-list>
        {matches.map((subject, index) => <div key={subject._id} id={`${id}-${subject._id}`}
          role="option" aria-selected={subject._id === selected?._id} data-subject-option={subject._id}
          data-highlighted={index === active} onPointerMove={() => setActive(index)}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(subject)}>
          <span><strong>{subject.name}</strong><small>{subject.level}</small></span>
          <code>{subject.code}</code>{subject._id === selected?._id && <Check size={14} aria-label="Selected" />}
        </div>)}
      </div>
      {!matches.length && <p role="status">No matching subjects. Try a name or code.</p>}
    </div>}
  </div>
}
