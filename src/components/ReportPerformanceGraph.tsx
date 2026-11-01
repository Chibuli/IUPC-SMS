import type { ReportGraph } from '../lib/report-performance-graph'

export function ReportPerformanceGraph({graph,compact=false,embedded=false}: {graph: ReportGraph; compact?: boolean; embedded?: boolean}) {
  const width = embedded ? 180 : 640
  const height = embedded ? 82 : 112
  const margin = embedded ? 24 : 64
  const bottom = embedded ? 58 : 86
  const top = embedded ? 17 : 20
  const points = graph.points.map((point,i)=>({
    ...point,
    x: graph.points.length===1 ? width/2 : margin+i*(width-2*margin)/(graph.points.length-1),
    y: bottom-(point.value/100)*(bottom-top),
  }))
  return <figure className={`report-progress${compact?' report-progress-compact':''}${embedded?' report-progress-embedded':''}`} data-graph-mode={graph.mode} data-graph-size={compact?'compact':'normal'} aria-label="Performance Trend">
    <figcaption><strong>Performance Trend</strong>{!embedded?<span>{graph.context}</span>:null}</figcaption>
    {points.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${graph.context}. ${points.map(point=>`${point.label}: ${point.value.toFixed(1)}%`).join('; ')}. ${graph.trend}`}>
      {!embedded?[0,50,100].map(value=>{const y=bottom-(value/100)*(bottom-top);return <g key={value}><line x1={margin-12} y1={y} x2={width-margin+12} y2={y} className="progress-grid"/><text x={margin-30} y={y+3} className="progress-axis-value">{value}%</text></g>}):<line x1={margin-12} y1={bottom+3} x2={width-margin+12} y2={bottom+3} className="progress-baseline"/>}
      {points.map((point,i)=>i>0 && point.order===points[i-1].order+1?<line key={`segment-${i}`} data-progress-segment={`${points[i-1].order}-${point.order}`} x1={points[i-1].x} y1={points[i-1].y} x2={point.x} y2={point.y} className="progress-line"/>:null)}
      {points.map(point=><g key={point.order} data-graph-point={point.label} data-graph-value={point.value}>
        <circle cx={point.x} cy={point.y} r={embedded?3.6:4.6} className="progress-marker"/>
        <text x={point.x} y={point.y-9} className="progress-value">{point.value.toFixed(1)}%</text>
        <text x={point.x} y={height-5} className="progress-term">{point.label}</text>
      </g>)}
    </svg>:<p className="report-progress-empty">No verified results available.</p>}
    {graph.unavailable.length?<p className="report-progress-unavailable">Unavailable: {graph.unavailable.join(' · ')}</p>:null}
  </figure>
}
