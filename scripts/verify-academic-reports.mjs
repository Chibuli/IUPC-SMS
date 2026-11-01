import puppeteer from 'puppeteer-core'
import { PDFDocument } from 'pdf-lib'
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
const out=path.resolve('.local-migration/academic-report-review')
// Execute the same pure pagination function as ClassListPrint, using browser-measured rows.
const source=await fs.readFile('src/lib/class-list-pagination.ts','utf8')
const {paginateClassList}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'))
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--disable-gpu']})
const results=[]
const stage1Baseline=process.argv.includes('--stage1')?JSON.parse(await fs.readFile(path.join(out,'before-stage1','verification.json'),'utf8')):null
try {
  const page=await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request',req=>/^https?:/.test(req.url())?req.abort():req.continue())
  await page.setViewport({width:718,height:1047,deviceScaleFactor:1})
  for(const name of (await fs.readdir(out)).filter(n=>n.endsWith('.html')&&n!=='index.html'&&(!process.argv.includes('--reports-only')||!n.startsWith('class-list')))) {
    const stem=name.slice(0,-5)
    await page.goto(pathToFileURL(path.join(out,name)).href,{waitUntil:'load'})
    await page.emulateMediaType('print')
    await page.evaluate(()=>document.fonts.ready)
    // Mirror live graph fitting: retain it, reduce height, and only then omit with a visible reason.
    const {graphOmitted,graphCompacted}=await page.evaluate(()=>{
      const report=document.querySelector('.intelligent-report'),graph=report?.querySelector('.report-progress')
      let graphCompacted=false,graphOmitted=false
      if(report && graph && report.scrollHeight>1040 && graph.dataset.graphSize!=='compact'){
        graph.classList.add('report-progress-compact');graph.dataset.graphSize='compact';graphCompacted=true
      }
      if(report && graph && report.scrollHeight>1040){
        graph.remove();graphOmitted=true
        const reason=document.createElement('p');reason.className='report-qualification';reason.textContent='Performance Trend: chart omitted because it exceeds the printable area at a readable size.'
        report.querySelector('.report-signoffs').before(reason)
      }
      return {graphOmitted,graphCompacted}
    })
    if(graphOmitted||graphCompacted)await fs.writeFile(path.join(out,name),await page.content())
    let expected=1
    if(stem.startsWith('class-list') && await page.$('#fixture-source')) {
      const measured=await page.evaluate(()=>{
        const source=document.querySelector('#fixture-source');source.style.width='190mm'
        const height=s=>{const el=source.querySelector(s),r=el.getBoundingClientRect(),style=getComputedStyle(el);return r.height+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0)}
        return {rowHeights:[...source.querySelectorAll('tbody tr')].map(r=>r.getBoundingClientRect().height),pageHeight:277*96/25.4,headerHeight:height('.classlist-page-header'),tableHeaderHeight:height('thead')+1,footerHeight:height('.classlist-footer'),signatureHeight:height('.classlist-signatures')}
      })
      const ranges=paginateClassList(measured);expected=ranges.length
      await page.evaluate(ranges=>{
        const src=document.querySelector('#fixture-source'),head=src.querySelector('.classlist-page-header'),table=src.querySelector('table'),rows=[...table.querySelectorAll('tbody tr')],sign=src.querySelector('.classlist-signatures'),footer=src.querySelector('footer')
        const output=document.createElement('div')
        ranges.forEach((range,i)=>{const section=document.createElement('section');section.className='sheet sheet-classlist classlist-page print-page';section.append(head.cloneNode(true));const t=table.cloneNode(true);t.querySelector('tbody').replaceChildren(...rows.slice(range.start,range.end).map(r=>r.cloneNode(true)));section.append(t);if(range.signatures)section.append(sign.cloneNode(true));const f=footer.cloneNode(true);f.lastElementChild.textContent=`Page ${i+1} of ${ranges.length}`;section.append(f);output.append(section)})
        src.replaceWith(output)
      },ranges)
      // Preserve the measured, paginated HTML for local inspection without running the app.
      await fs.writeFile(path.join(out,name),await page.content())
    }
    if(stem.startsWith('class-list'))expected=await page.$$eval('.classlist-page',nodes=>nodes.length)
    const pdf=await page.pdf({path:path.join(out,stem+'.pdf'),preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false})
    const doc=await PDFDocument.load(pdf)
    const metrics=await page.evaluate(()=>{
      const table=document.querySelector('.report-subjects,.classlist-table'),r=table.getBoundingClientRect()
      const approvals=[...document.querySelectorAll('.report-approval')].map(el=>{const b=el.getBoundingClientRect();return {top:b.top,bottom:b.bottom}})
      const approvalRowGap=approvals.length===4?approvals[2].top-Math.max(approvals[0].bottom,approvals[1].bottom):null
      const grading=document.querySelector('.report-grading')?.getBoundingClientRect(),signoffs=document.querySelector('.report-signoffs')?.getBoundingClientRect()
      const unsafeCharacters=[...document.querySelectorAll('.intelligent-report')].some(el=>el.textContent.includes('\ufffd')||el.textContent.includes('progress ?'))
      const graph=document.querySelector('.report-progress')?.getBoundingClientRect()
      return {graphRemarkOverlap:graph&&signoffs?graph.bottom>signoffs.top+.5:false,teacherInitials:[...document.querySelectorAll('.report-subjects tbody tr')].map(row=>row.lastElementChild.textContent),graphMode:document.querySelector('.report-progress')?.dataset.graphMode,graphLabels:[...document.querySelectorAll('[data-graph-point]')].map(el=>el.dataset.graphPoint),graphValues:[...document.querySelectorAll('[data-graph-point]')].map(el=>Number(el.dataset.graphValue)),graphSegments:document.querySelectorAll('[data-progress-segment]').length,approvalRowGap,gradingOverlap:grading&&signoffs?grading.top<signoffs.bottom:false,unsafeCharacters,tableWidth:r.width,clippedCells:[...table.querySelectorAll('th,td')].filter(c=>c.scrollWidth>c.clientWidth+2).length,blankColumns:[...document.querySelectorAll('.classlist-table tr')].every(r=>r.lastElementChild.textContent===''),blankColumnWidth:document.querySelector('.classlist-table th:last-child')?.getBoundingClientRect().width,watermarkOpacity:document.querySelector('.student-watermark')?getComputedStyle(document.querySelector('.student-watermark > span')).color:null,reportHeight:document.querySelector('.intelligent-report')?.getBoundingClientRect().height}
    })
    await page.screenshot({path:path.join(out,stem+'.png'),fullPage:true})
    const classlist=await page.evaluate(()=>({numbers:[...document.querySelectorAll('.classlist-table tbody tr')].map(r=>Number(r.firstElementChild.textContent)),signatures:document.querySelectorAll('.classlist-signatures').length}))
    if(stem.startsWith('class-list') && (classlist.signatures!==1 || classlist.numbers.length!==Number(stem.split('-').at(-1)) || classlist.numbers.some((n,i)=>n!==i+1)))throw Error('Class-list continuity/signature check failed')
    const result={graphOmitted,graphCompacted,fixture:stem,pages:doc.getPageCount(),expectedPages:expected,a4:doc.getPages().every(p=>Math.abs(p.getWidth()-595.28)<2&&Math.abs(p.getHeight()-841.89)<2),...metrics}
    if(stage1Baseline){
      const previous=stage1Baseline.find(row=>row.fixture===stem)
      if(previous && (JSON.stringify(previous.graphLabels)!==JSON.stringify(result.graphLabels)||JSON.stringify(previous.graphValues)!==JSON.stringify(result.graphValues)||previous.graphSegments!==result.graphSegments||previous.graphMode!==result.graphMode))throw Error(`Stage 1 altered graph data for ${stem}`)
      if(result.graphCompacted && !previous?.graphCompacted)throw Error(`Remarks required additional graph compression for ${stem}`)
    }
    results.push(result);console.log(JSON.stringify(result))
  }
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(results,null,2))
  if(results.some(r=>r.graphOmitted||r.pages!==r.expectedPages||!r.a4||r.clippedCells>0||r.gradingOverlap||r.graphRemarkOverlap||r.unsafeCharacters||(r.approvalRowGap!==null&&(r.approvalRowGap<0||r.approvalRowGap>22))))process.exitCode=1
} finally {await browser.close()}
