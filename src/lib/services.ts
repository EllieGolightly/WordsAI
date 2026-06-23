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
  ExportReminderState,
  HeatmapDay,
  LocalBackupSettings,
  LocalBackupSnapshotMeta,
  LocalBackupSnapshotV1,
  LocalDataCounts,
  LocalStorageDiagnostics,
  LibraryWord,
  RangeStats,
  ReviewDeckItem,
  ReviewGrade,
  ReviewLog,
  StatsSnapshot,
  TodaySnapshot,
  WordEntry,
} from './types'
import { LOCAL_BACKUP_SNAPSHOT_VERSION } from './types'

const LOCAL_BACKUP_SNAPSHOT_KEY = 'wordsai:local-backup-snapshot:v1'
const LOCAL_BACKUP_LAST_EXPORT_KEY = 'wordsai:last-json-export-at'
const LOCAL_BACKUP_LAST_REMINDER_KEY = 'wordsai:last-json-export-reminder-at'
const LOCAL_BACKUP_LAST_ERROR_KEY = 'wordsai:last-snapshot-error'
const EXPORT_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const SNAPSHOT_WRITE_DELAY_MS = 900
const SNAPSHOT_SAFE_SIZE_BYTES = 5 * 1024 * 1024
const seedWordIds = new Set(seedWords.map((word) => word.id))

let snapshotTimer: number | undefined

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

export const formatDateKey = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const startOfDay = (date = new Date()) => {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

const endOfDay = (date = new Date()) => {
  const copy = startOfDay(date)
  copy.setDate(copy.getDate() + 1)
  return copy
}

const getReviewedWordIdsForDay = async (date = new Date()) => {
  const from = startOfDay(date).toISOString()
  const to = endOfDay(date).toISOString()
  const logs = await db.reviewLogs.filter((log) => log.reviewedAt >= from && log.reviewedAt < to).toArray()
  return new Set(logs.map((log) => log.wordId))
}

const unique = <T,>(items: T[]) => [...new Set(items)]

const getLocalStorageItem = (key: string) => {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const setLocalStorageItem = (key: string, value: string) => {
  window.localStorage.setItem(key, value)
}

const removeLocalStorageItem = (key: string) => {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // localStorage may be unavailable in some private browsing modes.
  }
}

const toBytes = (value: string) => new Blob([value]).size

const parseIsoTime = (value?: string) => {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

const sanitizeSettingsForBackup = (settings: AppSettings): LocalBackupSettings => {
  return { ...settings, aiApiKey: '' }
}

const getCoreCounts = async (): Promise<LocalDataCounts> => {
  const [words, cards, reviewLogs, dailyPlans, aiContents, settings] = await Promise.all([
    db.words.count(),
    db.cards.count(),
    db.reviewLogs.count(),
    db.dailyPlans.count(),
    db.aiContents.count(),
    db.settings.count(),
  ])

  return { words, cards, reviewLogs, dailyPlans, aiContents, settings }
}

const countsHaveLearningData = (counts: LocalDataCounts) =>
  counts.cards + counts.reviewLogs + counts.dailyPlans + counts.aiContents > 0

const getBackupWords = async () => {
  const words = await db.words.toArray()
  return words.filter(
    (word) =>
      !seedWordIds.has(word.id) ||
      word.source === 'ai' ||
      word.source === 'imported' ||
      word.source === 'manual',
  )
}

export const getLocalBackupSnapshot = (): LocalBackupSnapshotV1 | undefined => {
  const raw = getLocalStorageItem(LOCAL_BACKUP_SNAPSHOT_KEY)
  if (!raw) return undefined

  try {
    const snapshot = JSON.parse(raw) as LocalBackupSnapshotV1
    if (snapshot.version !== LOCAL_BACKUP_SNAPSHOT_VERSION || !snapshot.data || !snapshot.summary) return undefined
    return snapshot
  } catch {
    return undefined
  }
}

const getLocalBackupSnapshotMeta = (): LocalBackupSnapshotMeta | undefined => {
  const raw = getLocalStorageItem(LOCAL_BACKUP_SNAPSHOT_KEY)
  if (!raw) return undefined

  try {
    const snapshot = JSON.parse(raw) as LocalBackupSnapshotV1
    if (snapshot.version !== LOCAL_BACKUP_SNAPSHOT_VERSION || !snapshot.summary) return undefined
    return {
      ...snapshot.summary,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      sizeBytes: toBytes(raw),
    }
  } catch {
    return undefined
  }
}

export const saveLocalBackupSnapshot = async () => {
  const [words, cards, reviewLogs, dailyPlans, aiContents, settings] = await Promise.all([
    getBackupWords(),
    db.cards.toArray(),
    db.reviewLogs.toArray(),
    db.dailyPlans.toArray(),
    db.aiContents.toArray(),
    db.settings.toArray(),
  ])

  const snapshot: LocalBackupSnapshotV1 = {
    version: LOCAL_BACKUP_SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    summary: {
      wordsCount: words.length,
      cardsCount: cards.length,
      reviewLogsCount: reviewLogs.length,
      dailyPlansCount: dailyPlans.length,
      aiContentsCount: aiContents.length,
    },
    data: {
      words,
      cards,
      reviewLogs,
      dailyPlans,
      aiContents,
      settings: settings.map(sanitizeSettingsForBackup),
    },
  }

  const serialized = JSON.stringify(snapshot)

  if (toBytes(serialized) > SNAPSHOT_SAFE_SIZE_BYTES) {
    setLocalStorageItem(LOCAL_BACKUP_LAST_ERROR_KEY, '本地快照超过 5MB 安全线，请导出 JSON 备份。')
    return { saved: false, reason: 'size' as const }
  }

  try {
    setLocalStorageItem(LOCAL_BACKUP_SNAPSHOT_KEY, serialized)
    removeLocalStorageItem(LOCAL_BACKUP_LAST_ERROR_KEY)
    return { saved: true as const, snapshot }
  } catch {
    try {
      setLocalStorageItem(LOCAL_BACKUP_LAST_ERROR_KEY, '本地快照写入失败，请导出 JSON 备份。')
    } catch {
      // Ignore secondary failure.
    }
    return { saved: false, reason: 'quota' as const }
  }
}

export const queueLocalBackupSnapshot = () => {
  window.clearTimeout(snapshotTimer)
  snapshotTimer = window.setTimeout(() => {
    void saveLocalBackupSnapshot()
  }, SNAPSHOT_WRITE_DELAY_MS)
}

export const restoreLocalBackupSnapshot = async () => {
  const snapshot = getLocalBackupSnapshot()
  if (!snapshot) throw new Error('没有可恢复的本地快照')

  await initializeApp()
  await db.transaction('rw', [db.words, db.cards, db.reviewLogs, db.dailyPlans, db.aiContents, db.settings], async () => {
    if (snapshot.data.words.length) await db.words.bulkPut(snapshot.data.words)
    if (snapshot.data.cards.length) await db.cards.bulkPut(snapshot.data.cards)
    if (snapshot.data.reviewLogs.length) await db.reviewLogs.bulkPut(snapshot.data.reviewLogs)
    if (snapshot.data.dailyPlans.length) await db.dailyPlans.bulkPut(snapshot.data.dailyPlans)
    if (snapshot.data.aiContents.length) await db.aiContents.bulkPut(snapshot.data.aiContents)
    if (snapshot.data.settings.length) {
      const existingSettings = await getSettings()
      await db.settings.bulkPut(
        snapshot.data.settings.map((settings) => ({
          ...defaultSettings,
          ...settings,
          aiApiKey: existingSettings.aiApiKey,
          id: 'default' as const,
        })),
      )
    }
  })
  await saveLocalBackupSnapshot()
}

const getExportReminderState = (): ExportReminderState => {
  const lastExportedAt = getLocalStorageItem(LOCAL_BACKUP_LAST_EXPORT_KEY) ?? undefined
  const lastReminderAt = getLocalStorageItem(LOCAL_BACKUP_LAST_REMINDER_KEY) ?? undefined
  const lastActivity = Math.max(parseIsoTime(lastExportedAt), parseIsoTime(lastReminderAt))
  const now = Date.now()
  const nextReminderTime = lastActivity > 0 ? lastActivity + EXPORT_REMINDER_INTERVAL_MS : now

  return {
    due: lastActivity === 0 || now >= nextReminderTime,
    lastExportedAt,
    lastReminderAt,
    nextReminderAt: new Date(nextReminderTime).toISOString(),
  }
}

export const markJsonExported = () => {
  setLocalStorageItem(LOCAL_BACKUP_LAST_EXPORT_KEY, new Date().toISOString())
}

export const snoozeJsonExportReminder = () => {
  setLocalStorageItem(LOCAL_BACKUP_LAST_REMINDER_KEY, new Date().toISOString())
}

export const getLocalStorageDiagnostics = async (): Promise<LocalStorageDiagnostics> => {
  const snapshot = getLocalBackupSnapshotMeta()
  const snapshotWriteError = getLocalStorageItem(LOCAL_BACKUP_LAST_ERROR_KEY) ?? undefined

  try {
    const counts = await getCoreCounts()
    return {
      origin: window.location.origin,
      indexedDbAvailable: true,
      counts,
      hasLearningData: countsHaveLearningData(counts),
      snapshot,
      snapshotWriteError,
      exportReminder: getExportReminderState(),
    }
  } catch (error) {
    return {
      origin: window.location.origin,
      indexedDbAvailable: false,
      indexedDbError: error instanceof Error ? error.message : 'IndexedDB 无法打开',
      counts: { words: 0, cards: 0, reviewLogs: 0, dailyPlans: 0, aiContents: 0, settings: 0 },
      hasLearningData: false,
      snapshot,
      snapshotWriteError,
      exportReminder: getExportReminderState(),
    }
  }
}

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
  queueLocalBackupSnapshot()
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

const createNewWordBatch = async (
  settings: AppSettings,
  count: number,
  excludeWordIds: Set<string>,
  weakWordIds: string[],
) => {
  const cards = await db.cards.toArray()
  const learnedIds = new Set(cards.map((card) => card.wordId))
  const words = await db.words.orderBy('frq').toArray()
  const filteredWords = await getFilteredWords(settings)
  const allowedIds = new Set(filteredWords.map((word) => word.id))
  const target = Math.max(0, Math.floor(count))

  const localNewWordIds = words
    .filter((word) => !learnedIds.has(word.id))
    .filter((word) => !excludeWordIds.has(word.id))
    .filter((word) => allowedIds.has(word.id))
    .slice(0, target)
    .map((word) => word.id)

  let generatedWordIds: string[] = []
  let source: DailyPlan['source'] = 'local'
  let aiError = ''
  const aiTarget = target

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
        .filter((word) => !excludeWordIds.has(buildAiWordId(word.word)))
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
        queueLocalBackupSnapshot()
        generatedWordIds = normalized.map((word) => word.id)
        source = localNewWordIds.length > generatedWordIds.length ? 'mixed' : 'ai'
      }
    } catch (error) {
      source = 'local'
      aiError = error instanceof Error ? error.message : 'AI 生成失败'
    }
  }

  const newWordIds = unique([...generatedWordIds, ...localNewWordIds]).slice(0, target)

  return { newWordIds, source, aiError }
}

export const ensureTodayPlan = async (date = new Date()) => {
  const dateKey = formatDateKey(date)
  const settings = await getSettings()
  const cards = await db.cards.toArray()
  const learnedIds = new Set(cards.map((card) => card.wordId))
  const dueWordIds = cards.filter((card) => new Date(card.dueAt) <= date).map((card) => card.wordId)
  const weakWordIds = (await getRecentWeakWordIds()).filter((wordId) => learnedIds.has(wordId))
  const target = Math.max(0, Math.floor(settings.newWordsPerDay))

  const existing = await db.dailyPlans.get(dateKey)
  if (existing) {
    const existingNewWordIds = unique(existing.newWordIds)
    const missingCount = Math.max(0, target - existingNewWordIds.length)
    const batch =
      missingCount > 0
        ? await createNewWordBatch(settings, missingCount, new Set([...existingNewWordIds, ...learnedIds]), weakWordIds)
        : { newWordIds: [], source: existing.source ?? 'local' }

    const plan: DailyPlan = {
      ...existing,
      newWordIds: unique([...existingNewWordIds, ...batch.newWordIds]),
      dueWordIds,
      weakWordIds,
      source:
        batch.newWordIds.length === 0
          ? existing.source
          : existing.source === 'ai' && batch.source === 'ai'
            ? 'ai'
            : 'mixed',
    }

    await db.dailyPlans.put(plan)
    queueLocalBackupSnapshot()
    return plan
  }

  const batch = await createNewWordBatch(settings, target, learnedIds, weakWordIds)

  const plan: DailyPlan = {
    dateKey,
    newWordIds: batch.newWordIds,
    dueWordIds,
    weakWordIds,
    source: batch.source,
    generatedAt: new Date().toISOString(),
  }
  await db.dailyPlans.put(plan)
  queueLocalBackupSnapshot()
  return plan
}

export const extendTodayPlan = async (date = new Date()) => {
  const settings = await getSettings()
  const plan = await ensureTodayPlan(date)
  const cards = await db.cards.toArray()
  const learnedIds = new Set(cards.map((card) => card.wordId))
  const weakWordIds = plan.weakWordIds ?? []
  const target = Math.max(1, Math.floor(settings.newWordsPerDay))
  const batch = await createNewWordBatch(settings, target, new Set([...plan.newWordIds, ...learnedIds]), weakWordIds)

  if (batch.newWordIds.length === 0) {
    return {
      plan,
      addedCount: 0,
      requestedCount: target,
      error: batch.aiError,
    }
  }

  const nextPlan: DailyPlan = {
    ...plan,
    newWordIds: unique([...plan.newWordIds, ...batch.newWordIds]),
    source: plan.source === 'ai' && batch.source === 'ai' ? 'ai' : 'mixed',
    generatedAt: new Date().toISOString(),
  }

  await db.dailyPlans.put(nextPlan)
  queueLocalBackupSnapshot()
  return {
    plan: nextPlan,
    addedCount: batch.newWordIds.length,
    requestedCount: target,
    error: batch.aiError,
  }
}

export const syncTodayNewWordTarget = async (date = new Date()) => {
  const settings = await getSettings()
  const plan = await ensureTodayPlan(date)
  const target = Math.max(0, Math.floor(settings.newWordsPerDay))
  const reviewedTodayIds = await getReviewedWordIdsForDay(date)
  const reviewedPlanIds = plan.newWordIds.filter((wordId) => reviewedTodayIds.has(wordId))
  const remainingPlanIds = plan.newWordIds.filter((wordId) => !reviewedTodayIds.has(wordId))
  const keptRemainingIds = remainingPlanIds.slice(0, target)
  const missingCount = Math.max(0, target - keptRemainingIds.length)
  const cards = await db.cards.toArray()
  const learnedIds = new Set(cards.map((card) => card.wordId))
  const batch =
    missingCount > 0
      ? await createNewWordBatch(
          settings,
          missingCount,
          new Set([...plan.newWordIds, ...learnedIds]),
          plan.weakWordIds ?? [],
        )
      : { newWordIds: [], source: plan.source ?? ('local' as const), aiError: '' }

  const nextPlan: DailyPlan = {
    ...plan,
    newWordIds: unique([...reviewedPlanIds, ...keptRemainingIds, ...batch.newWordIds]),
    source:
      batch.newWordIds.length === 0
        ? plan.source
        : plan.source === 'ai' && batch.source === 'ai'
          ? 'ai'
          : 'mixed',
    generatedAt: new Date().toISOString(),
  }

  await db.dailyPlans.put(nextPlan)
  queueLocalBackupSnapshot()

  return {
    plan: nextPlan,
    requestedCount: target,
    remainingCount: keptRemainingIds.length + batch.newWordIds.length,
    addedCount: batch.newWordIds.length,
    error: batch.aiError,
  }
}

export const getTodaySnapshot = async (date = new Date()): Promise<TodaySnapshot> => {
  await initializeApp()

  const dateKey = formatDateKey(date)
  const plan = await ensureTodayPlan(date)
  const todayStart = startOfDay(date).toISOString()
  const tomorrowStart = endOfDay(date).toISOString()

  const [cards, words, logs, aiContents] = await Promise.all([
    db.cards.toArray(),
    db.words.toArray(),
    db.reviewLogs.filter((log) => log.reviewedAt >= todayStart && log.reviewedAt < tomorrowStart).toArray(),
    db.aiContents.where('dateKey').equals(dateKey).sortBy('createdAt'),
  ])

  const latestLogByWord = new Map<string, ReviewLog>()
  logs
    .slice()
    .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
    .forEach((log) => latestLogByWord.set(log.wordId, log))
  const reviewedTodayIds = new Set(latestLogByWord.keys())
  const wordMap = new Map(words.map((word) => [word.id, word]))
  const dueCards = cards.filter((card) => new Date(card.dueAt) <= date && !reviewedTodayIds.has(card.wordId))
  const dueWords = dueCards
    .map((card) => wordMap.get(card.wordId))
    .filter((item): item is WordEntry => Boolean(item))

  const plannedNewWords = plan.newWordIds
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))
  const newWords = plannedNewWords.filter((word) => !reviewedTodayIds.has(word.id))
  const weakWords = (plan.weakWordIds ?? [])
    .filter((id) => !reviewedTodayIds.has(id))
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))

  const completedTodayCount = reviewedTodayIds.size
  const rememberedTodayCount = [...latestLogByWord.values()].filter((item) => item.grade === 'good').length
  const newWordIdSet = new Set(plan.newWordIds)
  const reviewedWords = unique([...reviewedTodayIds])
    .filter((id) => !newWordIdSet.has(id))
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))
  const wrongWords = [...latestLogByWord.values()]
    .filter((log) => log.grade === 'again')
    .map((log) => log.wordId)
    .map((id) => wordMap.get(id))
    .filter((item): item is WordEntry => Boolean(item))

  return {
    dateKey,
    plan,
    dueCards,
    newWords,
    plannedNewWords,
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
  queueLocalBackupSnapshot()

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
  queueLocalBackupSnapshot()

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
  queueLocalBackupSnapshot()

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
  queueLocalBackupSnapshot()

  return { ...record, id }
}

const buildRangeStats = async (days: number, label: string): Promise<RangeStats> => {
  const now = new Date()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
  const logs = await db.reviewLogs.filter((log) => log.reviewedAt >= from).toArray()
  const rememberedReviews = logs.filter((log) => log.grade === 'good').length
  const activeDays = unique(logs.map((log) => formatDateKey(new Date(log.reviewedAt)))).length
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
    const dateKey = formatDateKey(new Date(log.reviewedAt))
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
  const logs = await db.reviewLogs.toArray()
  const activeDates = new Set(logs.map((log) => formatDateKey(new Date(log.reviewedAt))))
  if (activeDates.size === 0) return 0

  const cursor = startOfDay(new Date())
  if (!activeDates.has(formatDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
  }

  let streak = 0
  while (activeDates.has(formatDateKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
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
  queueLocalBackupSnapshot()
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

  markJsonExported()

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
  queueLocalBackupSnapshot()
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
