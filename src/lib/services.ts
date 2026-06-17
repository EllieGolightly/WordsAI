import { db } from './db'
import { seedWords } from './seedWords'
import {
  generateAiExamples,
  generateAiSummary,
  generateAiWords,
  generateFallbackSummary,
  PROMPT_VERSION,
  testAiConnection,
} from './ai'
import { createFreshCard, scheduleReview } from './srs'
import type {
  AiContent,
  AppSettings,
  CardRecord,
  DailyPlan,
  DifficultWordStat,
  HeatmapDay,
  LibraryWord,
  RangeStats,
  ReviewDeckItem,
  ReviewGrade,
  ReviewLog,
  StatsSnapshot,
  TodaySnapshot,
  WordEntry,
} from './types'

export const defaultSettings: AppSettings = {
  id: 'default',
  newWordsPerDay: 8,
  wordBankPreset: 'core',
  schedulerType: 'sm2',
  difficultyPreference: 'balanced',
  maxAiWordsPerDay: 6,
  aiEnabled: false,
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
  aiApiKey: '',
}

export const formatDateKey = (date = new Date()) => date.toISOString().slice(0, 10)

const startOfDay = (date = new Date()) => {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

const unique = <T,>(items: T[]) => [...new Set(items)]

export const initializeApp = async () => {
  const wordsCount = await db.words.count()
  if (wordsCount === 0) {
    await db.words.bulkPut(seedWords)
  }

  const settings = await db.settings.get('default')
  if (!settings) {
    await db.settings.put(defaultSettings)
  }
}

export const getSettings = async () => ({ ...defaultSettings, ...((await db.settings.get('default')) ?? {}) })

export const saveSettings = async (partial: Partial<AppSettings>) => {
  const settings = await getSettings()
  const nextSettings = { ...defaultSettings, ...settings, ...partial, id: 'default' as const }
  await db.settings.put(nextSettings)
  return nextSettings
}

export const getWordMap = async () => {
  const words = await db.words.toArray()
  return new Map(words.map((word) => [word.id, word]))
}

const slugifyWord = (word: string) =>
  word
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const buildAiWordId = (word: string) => `ai-${slugifyWord(word)}`

const getFilteredWords = async (settings: AppSettings) => {
  const words = await db.words.orderBy('frq').toArray()
  return words.filter((word) => {
    if (settings.wordBankPreset === 'all') return true
    if (settings.wordBankPreset === 'core') return word.level === 'core'
    if (settings.wordBankPreset === 'advanced') return word.level === 'advanced'
    return true
  })
}

const getRecentWeakWordIds = async (limit = 6) => {
  const logs = await db.reviewLogs.orderBy('reviewedAt').reverse().toArray()
  const scores = new Map<string, { score: number; lastReviewedAt: string }>()

  logs.slice(0, 120).forEach((log) => {
    const current = scores.get(log.wordId) ?? { score: 0, lastReviewedAt: log.reviewedAt }
    scores.set(log.wordId, {
      score: current.score + (log.grade === 'again' ? 3 : -1),
      lastReviewedAt: current.lastReviewedAt > log.reviewedAt ? current.lastReviewedAt : log.reviewedAt,
    })
  })

  const cards = await db.cards.toArray()
  cards.forEach((card) => {
    if (card.lapses <= 0) return
    const current = scores.get(card.wordId) ?? { score: 0, lastReviewedAt: card.lastReviewedAt ?? card.createdAt }
    scores.set(card.wordId, {
      score: current.score + card.lapses * 2,
      lastReviewedAt: current.lastReviewedAt,
    })
  })

  return [...scores.entries()]
    .filter(([, item]) => item.score > 0)
    .sort((a, b) => b[1].score - a[1].score || b[1].lastReviewedAt.localeCompare(a[1].lastReviewedAt))
    .slice(0, limit)
    .map(([wordId]) => wordId)
}

export const ensureTodayPlan = async (date = new Date()) => {
  const dateKey = formatDateKey(date)
  const existing = await db.dailyPlans.get(dateKey)
  if (existing) return existing

  const settings = await getSettings()
  const cards = await db.cards.toArray()
  const learnedIds = new Set(cards.map((card) => card.wordId))
  const words = await db.words.orderBy('frq').toArray()
  const filteredWords = await getFilteredWords(settings)
  const allowedIds = new Set(filteredWords.map((word) => word.id))
  const dueWordIds = cards.filter((card) => new Date(card.dueAt) <= date).map((card) => card.wordId)
  const weakWordIds = (await getRecentWeakWordIds()).filter((wordId) => learnedIds.has(wordId))

  const localNewWordIds = words
    .filter((word) => !learnedIds.has(word.id))
    .filter((word) => allowedIds.has(word.id))
    .slice(0, Math.max(0, Math.floor(settings.newWordsPerDay)))
    .map((word) => word.id)

  let generatedWordIds: string[] = []
  let source: DailyPlan['source'] = 'local'
  const aiTarget = Math.max(0, Math.floor(settings.newWordsPerDay))

  if (settings.aiEnabled && settings.aiApiKey.trim() && aiTarget > 0) {
    try {
      const wordMap = new Map(words.map((word) => [word.id, word]))
      const recentAgainWords = weakWordIds
        .map((wordId) => wordMap.get(wordId))
        .filter((item): item is WordEntry => Boolean(item))
      const generatedWords = await generateAiWords(settings, {
        count: aiTarget,
        existingWords: words,
        recentAgainWords,
      })
      const nowIso = new Date().toISOString()
      const existingWordNames = new Set(words.map((word) => word.word.toLowerCase()))
      const normalized = generatedWords
        .filter((word) => !existingWordNames.has(word.word.trim().toLowerCase()))
        .map((word) => ({
          id: buildAiWordId(word.word),
          word: word.word.trim(),
          phonetic: word.phonetic,
          pos: word.pos,
          cn: word.cn,
          definition: word.definition,
          level: settings.difficultyPreference === 'challenge' ? 'advanced' : 'core',
          tags: unique([...(word.tags ?? []), 'ai']),
          source: 'ai' as const,
          memoryHint: word.memoryHint,
          examples: word.examples,
          difficulty: word.difficulty ?? settings.difficultyPreference,
          frq: 9000 + Math.floor(Math.random() * 1000),
          createdAt: nowIso,
        }))

      if (normalized.length > 0) {
        await db.words.bulkPut(normalized)
        generatedWordIds = normalized.map((word) => word.id)
        source = localNewWordIds.length > generatedWordIds.length ? 'mixed' : 'ai'
      }
    } catch {
      source = 'local'
    }
  }

  const newWordIds = unique([...generatedWordIds, ...localNewWordIds]).slice(
    0,
    Math.max(0, Math.floor(settings.newWordsPerDay)),
  )

  const plan: DailyPlan = {
    dateKey,
    newWordIds,
    dueWordIds,
    weakWordIds,
    source,
    generatedAt: new Date().toISOString(),
  }
  await db.dailyPlans.put(plan)
  return plan
}

export const getTodaySnapshot = async (date = new Date()): Promise<TodaySnapshot> => {
  await initializeApp()

  const dateKey = formatDateKey(date)
  const plan = await ensureTodayPlan(date)
  const todayStart = startOfDay(date).toISOString()
  const nowIso = date.toISOString()

  const [cards, words, logs, aiContents] = await Promise.all([
    db.cards.toArray(),
    db.words.toArray(),
    db.reviewLogs.filter((log) => log.reviewedAt >= todayStart && log.reviewedAt <= nowIso).toArray(),
    db.aiContents.where('dateKey').equals(dateKey).sortBy('createdAt'),
  ])

  const wordMap = new Map(words.map((word) => [word.id, word]))
  const dueCards = cards.filter((card) => new Date(card.dueAt) <= date)
  const dueWords = dueCards
    .map((card) => wordMap.get(card.wordId))
    .filter((item): item is WordEntry => Boolean(item))

  const newWords = plan.newWordIds
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))
  const weakWords = (plan.weakWordIds ?? [])
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))

  const completedTodayCount = logs.length
  const rememberedTodayCount = logs.filter((item) => item.grade === 'good').length
  const newWordIdSet = new Set(plan.newWordIds)
  const reviewedWords = unique(logs.map((log) => log.wordId))
    .filter((id) => !newWordIdSet.has(id))
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))
  const wrongWords = unique(logs.filter((log) => log.grade === 'again').map((log) => log.wordId))
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))

  return {
    dateKey,
    plan,
    dueCards,
    newWords,
    dueWords,
    weakWords,
    reviewedWords,
    wrongWords,
    completedTodayCount,
    rememberedTodayCount,
    summary: aiContents.at(-1),
  }
}

export const getReviewDeck = async (date = new Date()): Promise<ReviewDeckItem[]> => {
  const snapshot = await getTodaySnapshot(date)
  const settings = await getSettings()
  const cards = await db.cards.toArray()
  const wordMap = await getWordMap()
  const aiEntries = snapshot.summary?.payload.entries ?? []
  const enhancementMap = new Map(aiEntries.map((entry) => [entry.wordId, entry]))
  const cardMap = new Map(cards.map((card) => [card.wordId, card]))

  const orderedIds = unique([
    ...snapshot.dueWords.map((word) => word.id),
    ...snapshot.weakWords.map((word) => word.id),
    ...snapshot.newWords.map((word) => word.id),
  ])

  const deck: ReviewDeckItem[] = []

  orderedIds.forEach((wordId) => {
    const word = wordMap.get(wordId)
    if (!word) return

    const currentCard = cardMap.get(wordId) ?? createFreshCard(wordId, settings.schedulerType)
    deck.push({
      word,
      card: currentCard,
      enhancement: enhancementMap.get(wordId),
    })
  })

  return deck
}

export const submitReview = async (wordId: string, grade: ReviewGrade, date = new Date()) => {
  const settings = await getSettings()
  const existingCard = (await db.cards.get(wordId)) ?? createFreshCard(wordId, settings.schedulerType, date)
  const nextCard = scheduleReview(
    {
      ...existingCard,
      schedulerType: settings.schedulerType,
    },
    grade,
    date,
  )

  const log: ReviewLog = {
    wordId,
    reviewedAt: date.toISOString(),
    grade,
    schedulerType: settings.schedulerType,
    prevDueAt: existingCard.dueAt,
    nextDueAt: nextCard.dueAt,
    intervalDays: nextCard.intervalDays,
  }

  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.cards.put(nextCard)
    await db.reviewLogs.add(log)
  })

  return nextCard
}

export const ensureWordExamples = async (wordId: string) => {
  const word = await db.words.get(wordId)
  if (!word) return []
  if (word.examples?.length) return word.examples

  const settings = await getSettings()
  const examples = await generateAiExamples(settings, word)
  if (examples.length === 0) return []

  await db.words.put({
    ...word,
    examples,
  })

  return examples
}

export const testAiSettings = async (settings: AppSettings) => {
  await testAiConnection({ ...defaultSettings, ...settings, id: 'default' })
  return true
}

export const undoLastReview = async () => {
  const lastLog = await db.reviewLogs.orderBy('reviewedAt').reverse().first()
  if (!lastLog?.id) return false

  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    if (lastLog.prevDueAt) {
      const card = await db.cards.get(lastLog.wordId)
      if (card) {
        await db.cards.put({
          ...card,
          dueAt: lastLog.prevDueAt,
          lastReviewedAt: undefined,
          reps: Math.max(0, card.reps - 1),
          lapses: lastLog.grade === 'again' ? Math.max(0, card.lapses - 1) : card.lapses,
          intervalDays: Math.max(0, card.intervalDays),
        })
      }
    }
    await db.reviewLogs.delete(lastLog.id!)
  })

  return true
}

export const generateTodaySummary = async (date = new Date()) => {
  const snapshot = await getTodaySnapshot(date)
  const settings = await getSettings()

  let payload: AiContent['payload']
  let status: AiContent['status']

  try {
    payload = await generateAiSummary(snapshot, settings)
    status = settings.aiEnabled && settings.aiApiKey.trim() ? 'ready' : 'fallback'
  } catch {
    payload = generateFallbackSummary(snapshot)
    status = 'fallback'
  }

  const record: AiContent = {
    dateKey: snapshot.dateKey,
    model: settings.aiModel,
    promptVersion: PROMPT_VERSION,
    payload,
    createdAt: new Date().toISOString(),
    status,
  }

  const id = await db.aiContents.add(record)
  const plan = await ensureTodayPlan(date)
  await db.dailyPlans.put({ ...plan, aiContentId: id })

  return { ...record, id }
}

const buildRangeStats = async (days: number, label: string): Promise<RangeStats> => {
  const now = new Date()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  const logs = await db.reviewLogs.filter((log) => log.reviewedAt >= from).toArray()
  const rememberedReviews = logs.filter((log) => log.grade === 'good').length
  const activeDays = unique(logs.map((log) => log.reviewedAt.slice(0, 10))).length
  const newCards = unique(
    logs
      .filter((log) => log.intervalDays <= 1)
      .map((log) => log.wordId),
  ).length

  return {
    label,
    totalReviews: logs.length,
    rememberedReviews,
    rememberRate: logs.length === 0 ? 0 : Math.round((rememberedReviews / logs.length) * 100),
    activeDays,
    newCards,
  }
}

const buildHeatmap = async (days = 35): Promise<HeatmapDay[]> => {
  const now = startOfDay(new Date())
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  const logs = await db.reviewLogs.filter((log) => log.reviewedAt >= from.toISOString()).toArray()
  const byDate = new Map<string, HeatmapDay>()

  for (let index = 0; index < days; index += 1) {
    const date = new Date(from.getTime() + index * 24 * 60 * 60 * 1000)
    const dateKey = formatDateKey(date)
    byDate.set(dateKey, { dateKey, totalReviews: 0, rememberedReviews: 0 })
  }

  logs.forEach((log) => {
    const dateKey = log.reviewedAt.slice(0, 10)
    const item = byDate.get(dateKey)
    if (!item) return
    item.totalReviews += 1
    if (log.grade === 'good') item.rememberedReviews += 1
  })

  return [...byDate.values()]
}

const getDifficultWords = async (): Promise<DifficultWordStat[]> => {
  const [logs, wordMap, cards] = await Promise.all([
    db.reviewLogs.toArray(),
    getWordMap(),
    db.cards.toArray(),
  ])
  const cardMap = new Map(cards.map((card) => [card.wordId, card]))
  const againStats = new Map<string, { againCount: number; lastReviewedAt?: string }>()

  logs.forEach((log) => {
    if (log.grade !== 'again') return
    const current = againStats.get(log.wordId) ?? { againCount: 0, lastReviewedAt: undefined }
    againStats.set(log.wordId, {
      againCount: current.againCount + 1,
      lastReviewedAt:
        !current.lastReviewedAt || current.lastReviewedAt < log.reviewedAt ? log.reviewedAt : current.lastReviewedAt,
    })
  })

  const difficultWords: DifficultWordStat[] = []

  againStats.forEach((item, wordId) => {
    const word = wordMap.get(wordId)
    if (!word) return
    difficultWords.push({
        word,
        againCount: item.againCount,
        lastReviewedAt: item.lastReviewedAt,
        lapses: cardMap.get(wordId)?.lapses ?? 0,
    })
  })

  return difficultWords
    .sort((a, b) => b.againCount + b.lapses - (a.againCount + a.lapses))
    .slice(0, 6)
}

const getStreakDays = async () => {
  const logs = await db.reviewLogs.orderBy('reviewedAt').reverse().toArray()
  const dates = unique(logs.map((log) => log.reviewedAt.slice(0, 10)))
  if (dates.length === 0) return 0

  let streak = 0
  let cursor = startOfDay(new Date())

  for (const key of dates) {
    const cursorKey = formatDateKey(cursor)
    if (key === cursorKey) {
      streak += 1
      cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000)
      continue
    }

    if (streak === 0 && key === formatDateKey(new Date(cursor.getTime() - 24 * 60 * 60 * 1000))) {
      streak += 1
      cursor = new Date(cursor.getTime() - 48 * 60 * 60 * 1000)
      continue
    }
    break
  }

  return streak
}

export const getStatsSnapshot = async (): Promise<StatsSnapshot> => {
  const [cards, dueCards, week, month, year, streakDays, heatmap, difficultWords] = await Promise.all([
    db.cards.toArray(),
    db.cards.filter((card) => new Date(card.dueAt) <= new Date()).toArray(),
    buildRangeStats(7, '最近 7 天'),
    buildRangeStats(30, '最近 30 天'),
    buildRangeStats(365, '最近 365 天'),
    getStreakDays(),
    buildHeatmap(),
    getDifficultWords(),
  ])

  return {
    todayDue: dueCards.length,
    totalLearned: cards.length,
    streakDays,
    week,
    month,
    year,
    heatmap,
    difficultWords,
  }
}

export const getLibraryWords = async (query: string, filter: 'all' | 'learned' | 'unlearned' = 'all') => {
  const trimmed = query.trim().toLowerCase()
  const words = await db.words.orderBy('frq').toArray()
  const cards = await db.cards.toArray()
  const cardMap = new Map(cards.map((card) => [card.wordId, card]))

  return words
    .filter((word) => {
      if (!trimmed) return true
      return (
        word.word.toLowerCase().includes(trimmed) ||
        word.cn.includes(trimmed) ||
        word.definition.toLowerCase().includes(trimmed)
      )
    })
    .map((word): LibraryWord => {
      const card = cardMap.get(word.id)
      return {
        ...word,
        learned: Boolean(card),
        dueAt: card?.dueAt,
        lapses: card?.lapses,
        stage: card?.stage,
      }
    })
    .filter((word) => {
      if (filter === 'learned') return word.learned
      if (filter === 'unlearned') return !word.learned
      return true
    })
}

export const addWordToToday = async (wordId: string, date = new Date()) => {
  const plan = await ensureTodayPlan(date)
  if (plan.newWordIds.includes(wordId)) return plan
  const nextPlan = {
    ...plan,
    newWordIds: unique([wordId, ...plan.newWordIds]),
    source: plan.source === 'ai' ? ('mixed' as const) : plan.source ?? ('local' as const),
  }
  await db.dailyPlans.put(nextPlan)
  return nextPlan
}

export const exportProgress = async () => {
  const [words, cards, reviewLogs, dailyPlans, aiContents, settings] = await Promise.all([
    db.words.toArray(),
    db.cards.toArray(),
    db.reviewLogs.toArray(),
    db.dailyPlans.toArray(),
    db.aiContents.toArray(),
    db.settings.toArray(),
  ])

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    words,
    cards,
    reviewLogs,
    dailyPlans,
    aiContents,
    settings,
  }
}

export const importProgress = async (fileText: string) => {
  const data = JSON.parse(fileText) as {
    words?: WordEntry[]
    cards?: CardRecord[]
    reviewLogs?: ReviewLog[]
    dailyPlans?: DailyPlan[]
    aiContents?: AiContent[]
    settings?: AppSettings[]
  }

  if (data.words?.length) await db.words.bulkPut(data.words)
  if (data.cards?.length) await db.cards.bulkPut(data.cards)
  if (data.reviewLogs?.length) await db.reviewLogs.bulkPut(data.reviewLogs)
  if (data.dailyPlans?.length) await db.dailyPlans.bulkPut(data.dailyPlans)
  if (data.aiContents?.length) await db.aiContents.bulkPut(data.aiContents)
  if (data.settings?.length) await db.settings.bulkPut(data.settings)
}

export const getPersistentStorageSupport = async () => {
  if (!('storage' in navigator) || !navigator.storage?.persist) {
    return { supported: false, persisted: false }
  }

  const persisted = await navigator.storage.persisted()
  return { supported: true, persisted }
}

export const requestPersistentStorage = async () => {
  if (!('storage' in navigator) || !navigator.storage?.persist) return false
  return navigator.storage.persist()
}
