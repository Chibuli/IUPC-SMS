export interface ClassListPageRange { start: number; end: number; signatures: boolean }

/** Pack measured rows into the printable area. No assumed number of students per page. */
export function paginateClassList({ rowHeights, pageHeight, headerHeight, tableHeaderHeight, footerHeight, signatureHeight }: {
  rowHeights: number[]; pageHeight: number; headerHeight: number; tableHeaderHeight: number; footerHeight: number; signatureHeight: number
}): ClassListPageRange[] {
  const capacity = pageHeight - headerHeight - tableHeaderHeight - footerHeight - 2
  if (![capacity,signatureHeight,...rowHeights].every(Number.isFinite) || capacity <= 0 || signatureHeight < 0 || rowHeights.some(h=>h<=0||h>capacity)) throw Error('A student row or letterhead exceeds the available A4 print area.')
  const pages: ClassListPageRange[] = []
  let start=0,used=0
  for(let i=0;i<rowHeights.length;i++){
    if(used+rowHeights[i]>capacity){pages.push({start,end:i,signatures:false});start=i;used=0}
    used+=rowHeights[i]
  }
  if(signatureHeight>capacity)throw Error('The signature section exceeds the available A4 print area.')
  if(used+signatureHeight<=capacity)pages.push({start,end:rowHeights.length,signatures:true})
  else {pages.push({start,end:rowHeights.length,signatures:false});pages.push({start:rowHeights.length,end:rowHeights.length,signatures:true})}
  return pages
}
