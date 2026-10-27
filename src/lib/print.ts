import { useEffect } from 'react'

export type PrintPage = 'timetable' | 'master' | 'broadsheet' | 'report' | 'classlist' | 'analysis' | 'deck' | 'analysis'

/**
 * Named CSS pages isolate each printed artefact (A4 landscape timetable vs A4
 * portrait report card). The name has to live on the document root: applying it
 * only to the sheet makes the browser open a second, empty page first.
 */
export function usePrintPage(name: PrintPage) {
  useEffect(() => {
    document.body.dataset.page = name
    return () => {
      delete document.body.dataset.page
    }
  }, [name])
}
