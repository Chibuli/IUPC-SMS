import type { GradeBand } from '../data/types'

export const ACHIEVEMENT_CATEGORIES = ['highest','veryStrong','strong','satisfactory','developing','below','support'] as const
export type AchievementCategory = typeof ACHIEVEMENT_CATEGORIES[number]
type RemarkTrend = 'baseline' | 'Improving' | 'Stationary' | 'Dropped'
export interface SubjectRemarkPolicy {
  maxCharacters: number
  maxWords: number
  /** Presentation categories in descending band order, never score thresholds. */
  categoriesByBandCount: Readonly<Record<number, readonly AchievementCategory[]>>
  /** Optional explicit presentation mapping for a particular configured scale. No persisted field/UI. */
  gradeCategories?: Readonly<Record<string, AchievementCategory>>
  catalogue: Readonly<Record<AchievementCategory, Readonly<Record<RemarkTrend, string>>>>
}
export const SUBJECT_REMARK_POLICY: SubjectRemarkPolicy = {
  maxCharacters:32,
  maxWords:7,
  // The existing nine-band scale has three support bands. Labels and thresholds remain school-owned.
  categoriesByBandCount:{9:['highest','veryStrong','strong','satisfactory','developing','below','support','support','support']},
  catalogue:{
    highest:{baseline:'Outstanding achievement',Improving:'Excellent progress',Stationary:'Consistently outstanding',Dropped:'Strong; regain consistency'},
    veryStrong:{baseline:'Very good performance',Improving:'Very good progress',Stationary:'Consistently strong',Dropped:'Strong; regain consistency'},
    strong:{baseline:'Good work; aim higher',Improving:'Good progress; aim higher',Stationary:'Steady; aim higher',Dropped:'Good; regain consistency'},
    satisfactory:{baseline:'Satisfactory progress',Improving:'Encouraging progress',Stationary:'Steady; aim higher',Dropped:'Focus on recovery'},
    developing:{baseline:'Improvement needed',Improving:'Improving; keep going',Stationary:'Further progress needed',Dropped:'Focus on recovery'},
    below:{baseline:'Improve consistency',Improving:'Encouraging improvement',Stationary:'Strengthen consistency',Dropped:'Additional support advised'},
    support:{baseline:'Needs focused support',Improving:'Progress; continue support',Stationary:'Continued support needed',Dropped:'Focused support advised'},
  },
}

/** Map an already-resolved band, not a score. Never re-grade or depend on letter labels/points. */
export function achievementForBand(band: GradeBand | null, bands: readonly GradeBand[], policy: SubjectRemarkPolicy = SUBJECT_REMARK_POLICY): AchievementCategory | null {
  if(!band || !bands.length || bands.some(b=>!Number.isFinite(b.min_score)) || new Set(bands.map(b=>b.grade)).size!==bands.length || new Set(bands.map(b=>b.min_score)).size!==bands.length)return null
  const ordered=[...bands].sort((a,b)=>b.min_score-a.min_score)
  const index=ordered.findIndex(b=>b.grade===band.grade && b.min_score===band.min_score)
  if(index<0)return null
  if(policy.gradeCategories && Object.hasOwn(policy.gradeCategories,band.grade))return policy.gradeCategories[band.grade]
  const configured=policy.categoriesByBandCount[ordered.length]
  if(configured?.length===ordered.length)return configured[index]
  // With no reliable hierarchy, use neutral wording rather than inventing achievement.
  if(ordered.length===1)return null
  return ACHIEVEMENT_CATEGORIES[Math.round(index/(ordered.length-1)*(ACHIEVEMENT_CATEGORIES.length-1))]
}

export interface SubjectRemarkInput {
  band: GradeBand | null
  bands: readonly GradeBand[]
  resultStatus: string
  eligibilityKnown: boolean
  termNumber: number
  /** Existing subject term-to-term comparison; never the overall graph's assessment trend. */
  trend: string
  componentStatuses?: readonly string[]
  /** Only the existing accepted-remark facility; this utility creates no editing workflow. */
  override?: string
}
export function subjectRemark(input: SubjectRemarkInput, policy: SubjectRemarkPolicy = SUBJECT_REMARK_POLICY): string {
  const {resultStatus}=input
  if(resultStatus==='N/T'||resultStatus==='N/A')return resultStatus
  if(!input.eligibilityKnown || resultStatus.startsWith('Unresolved'))return 'Unresolved'
  if(resultStatus!=='Complete' && !resultStatus.startsWith('Provisional')){
    if(resultStatus==='Irregularity' || input.componentStatuses?.includes('Irregularity'))return 'Irregularity'
    if(resultStatus==='Pending' || (input.componentStatuses?.length && input.componentStatuses.every(status=>status==='Pending')))return 'Pending'
    return resultStatus==='INC'?'INC':'—'
  }
  if(!input.band)return '—'
  if(input.override?.trim())return input.override.trim()
  const category=achievementForBand(input.band,input.bands,policy)
  const comparison=input.termNumber>1 ? /^(Improving|Stationary|Dropped)(?:\s|$)/.exec(input.trend)?.[1] as Exclude<RemarkTrend,'baseline'>|undefined : undefined
  const remark=category ? policy.catalogue[category][comparison??'baseline'] : 'Result recorded'
  return remark.length<=policy.maxCharacters && remark.split(/\s+/).length<=policy.maxWords ? remark : '—'
}
