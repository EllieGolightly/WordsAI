import Dexie, { type Table } from 'dexie'
import type {
  AiContent,
  AppSettings,
  CardRecord,
  DailyPlan,
  ReviewLog,
  WordEntry,
} from './types'

export class WordMemoDb extends Dexie {
  words!: Table<WordEntry, string>
  cards!: Table<CardRecord, string>
  reviewLogs!: Table<ReviewLog, number>
  dailyPlans!: Table<DailyPlan, string>
  aiContents!: Table<AiContent, number>
  settings!: Table<AppSettings, 'default'>

  constructor() {
    super('wordMemoDb')

    this.version(1).stores({
      words: '&id, word, frq, level',
      cards: '&wordId, dueAt, lastReviewedAt, schedulerType',
      reviewLogs: '++id, reviewedAt, wordId, grade',
      dailyPlans: '&dateKey, generatedAt',
      aiContents: '++id, dateKey, createdAt, status',
      settings: '&id',
    })
  }
}

export const db = new WordMemoDb()
