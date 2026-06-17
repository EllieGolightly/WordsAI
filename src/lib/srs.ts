import type { CardRecord, ReviewGrade, SchedulerType } from './types'

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60 * 1000).toISOString()

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

export const createFreshCard = (
  wordId: string,
  schedulerType: SchedulerType,
  now = new Date(),
): CardRecord => ({
  wordId,
  stage: 'new',
  dueAt: now.toISOString(),
  createdAt: now.toISOString(),
  schedulerType,
  reps: 0,
  intervalDays: 0,
  easeFactor: 2.5,
  lapses: 0,
  stability: 0.6,
  difficulty: 5,
})

export const scheduleReview = (
  card: CardRecord,
  grade: ReviewGrade,
  now = new Date(),
): CardRecord => {
  if (card.schedulerType === 'fsrs') {
    return scheduleFsrs(card, grade, now)
  }

  return scheduleSm2(card, grade, now)
}

const scheduleSm2 = (card: CardRecord, grade: ReviewGrade, now: Date): CardRecord => {
  if (grade === 'again') {
    return {
      ...card,
      stage: 'relearning',
      reps: 0,
      intervalDays: 0,
      lapses: card.lapses + 1,
      dueAt: addMinutes(now, 10),
      lastReviewedAt: now.toISOString(),
    }
  }

  const nextReps = card.reps + 1
  const nextInterval =
    nextReps === 1 ? 1 : nextReps === 2 ? 6 : Math.max(1, Math.round(card.intervalDays * card.easeFactor))

  return {
    ...card,
    stage: 'review',
    reps: nextReps,
    intervalDays: nextInterval,
    dueAt: addDays(now, nextInterval),
    lastReviewedAt: now.toISOString(),
  }
}

const scheduleFsrs = (card: CardRecord, grade: ReviewGrade, now: Date): CardRecord => {
  if (grade === 'again') {
    const newDifficulty = Math.min(10, card.difficulty + 0.7)

    return {
      ...card,
      stage: 'relearning',
      reps: 0,
      intervalDays: 0,
      lapses: card.lapses + 1,
      stability: Math.max(0.45, card.stability * 0.6),
      difficulty: newDifficulty,
      dueAt: addMinutes(now, 10),
      lastReviewedAt: now.toISOString(),
    }
  }

  const nextStability = card.reps === 0 ? 1.2 : card.stability * (1.9 - card.difficulty * 0.05)
  const normalizedStability = Math.max(1, Number(nextStability.toFixed(2)))
  const interval = Math.max(1, Math.round(normalizedStability * 1.7))

  return {
    ...card,
    stage: 'review',
    reps: card.reps + 1,
    intervalDays: interval,
    stability: normalizedStability,
    difficulty: Math.max(2.5, Number((card.difficulty - 0.2).toFixed(2))),
    dueAt: addDays(now, interval),
    lastReviewedAt: now.toISOString(),
  }
}
