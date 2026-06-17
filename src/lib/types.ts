export type SchedulerType = 'sm2' | 'fsrs'

export type ReviewGrade = 'again' | 'good'

export type CardStage = 'new' | 'learning' | 'review' | 'relearning'

export type WordBankPreset = 'core' | 'advanced' | 'all'

export type WordSource = 'seed' | 'ai' | 'imported' | 'manual'

export type DifficultyPreference = 'gentle' | 'balanced' | 'challenge'

export type WordEntry = {
  id: string
  word: string
  phonetic?: string
  pos?: string
  cn: string
  definition: string
  level?: string
  tags?: string[]
  frq?: number
  source?: WordSource
  memoryHint?: string
  examples?: string[]
  difficulty?: DifficultyPreference
  createdAt?: string
}

export type CardRecord = {
  wordId: string
  stage: CardStage
  dueAt: string
  lastReviewedAt?: string
  createdAt: string
  schedulerType: SchedulerType
  reps: number
  intervalDays: number
  easeFactor: number
  lapses: number
  stability: number
  difficulty: number
}

export type ReviewLog = {
  id?: number
  wordId: string
  reviewedAt: string
  grade: ReviewGrade
  schedulerType: SchedulerType
  prevDueAt?: string
  nextDueAt: string
  intervalDays: number
}

export type DailyPlan = {
  dateKey: string
  newWordIds: string[]
  dueWordIds?: string[]
  weakWordIds?: string[]
  source?: 'local' | 'ai' | 'mixed'
  generatedAt: string
  aiContentId?: number
}

export type AiWordEnhancement = {
  wordId: string
  memoryHint: string
  examples: string[]
}

export type AiGeneratedWord = {
  word: string
  phonetic?: string
  pos?: string
  cn: string
  definition: string
  memoryHint: string
  examples: string[]
  difficulty?: DifficultyPreference
  tags?: string[]
}

export type AiContentPayload = {
  summaryText: string
  highlights: string[]
  tomorrowPlan: string[]
  entries: AiWordEnhancement[]
  markdown?: string
  generatedWords?: AiGeneratedWord[]
}

export type AiContent = {
  id?: number
  dateKey: string
  model: string
  promptVersion: string
  payload: AiContentPayload
  createdAt: string
  status: 'ready' | 'fallback' | 'error'
}

export type AppSettings = {
  id: 'default'
  newWordsPerDay: number
  wordBankPreset: WordBankPreset
  schedulerType: SchedulerType
  difficultyPreference: DifficultyPreference
  maxAiWordsPerDay: number
  aiEnabled: boolean
  aiBaseUrl: string
  aiModel: string
  aiApiKey: string
}

export type TodaySnapshot = {
  dateKey: string
  plan: DailyPlan
  dueCards: CardRecord[]
  newWords: WordEntry[]
  dueWords: WordEntry[]
  weakWords: WordEntry[]
  reviewedWords: WordEntry[]
  wrongWords: WordEntry[]
  completedTodayCount: number
  rememberedTodayCount: number
  summary?: AiContent
}

export type ReviewDeckItem = {
  word: WordEntry
  card?: CardRecord
  enhancement?: AiWordEnhancement
}

export type RangeStats = {
  label: string
  totalReviews: number
  rememberedReviews: number
  rememberRate: number
  activeDays: number
  newCards: number
}

export type HeatmapDay = {
  dateKey: string
  totalReviews: number
  rememberedReviews: number
}

export type DifficultWordStat = {
  word: WordEntry
  againCount: number
  lastReviewedAt?: string
  lapses: number
}

export type StatsSnapshot = {
  todayDue: number
  totalLearned: number
  streakDays: number
  week: RangeStats
  month: RangeStats
  year: RangeStats
  heatmap: HeatmapDay[]
  difficultWords: DifficultWordStat[]
}

export type LibraryWord = WordEntry & {
  learned: boolean
  dueAt?: string
  lapses?: number
  stage?: CardStage
}
