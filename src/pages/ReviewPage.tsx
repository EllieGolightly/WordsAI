import { Check, Volume2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReviewDeckItem } from '../lib/types'

export function ReviewPage({
  deck,
  onReview,
  onEnsureExamples,
  onLoadMoreWords,
}: {
  deck: ReviewDeckItem[]
  onReview: (wordId: string, grade: 'again' | 'good') => void
  onEnsureExamples: (wordId: string) => Promise<string[]>
  onLoadMoreWords: () => Promise<void>
}) {
  const [sessionTotal, setSessionTotal] = useState(deck.length)
  const [completedInSession, setCompletedInSession] = useState(0)
  const previousDeckLength = useRef(deck.length)
  const [revealed, setRevealed] = useState(false)
  const [loadingExamplesFor, setLoadingExamplesFor] = useState<string | null>(null)
  const [exampleErrors, setExampleErrors] = useState<Record<string, string>>({})
  const [generatedExamples, setGeneratedExamples] = useState<Record<string, string[]>>({})

  const current = deck[0]
  const currentPosition = Math.min(completedInSession + 1, Math.max(sessionTotal, 1))
  const progress = sessionTotal === 0 ? 100 : Math.round((currentPosition / sessionTotal) * 100)

  useEffect(() => {
    const previousLength = previousDeckLength.current
    if (deck.length > 0 && (previousLength === 0 || deck.length > previousLength)) {
      setSessionTotal(deck.length)
      setCompletedInSession(0)
    }
    previousDeckLength.current = deck.length
  }, [deck.length])

  const examples = useMemo(() => {
    if (!current) return []
    if (generatedExamples[current.word.id]?.length) return generatedExamples[current.word.id]
    if (current.enhancement?.examples?.length) return current.enhancement.examples
    return current.word.examples ?? []
  }, [current, generatedExamples])

  const speak = () => {
    if (!current || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(current.word.word)
    utterance.lang = 'en-US'
    utterance.rate = 0.86
    window.speechSynthesis.speak(utterance)
  }

  const nextStep = async (grade: 'again' | 'good') => {
    if (!current) return
    await onReview(current.word.id, grade)
    setRevealed(false)
    setCompletedInSession((count) => Math.min(sessionTotal, count + 1))
  }

  const toggleReveal = async () => {
    if (!current) return
    const shouldReveal = !revealed
    setRevealed(shouldReveal)

    if (!shouldReveal || examples.length > 0 || loadingExamplesFor === current.word.id) return

    setLoadingExamplesFor(current.word.id)
    setExampleErrors((errors) => ({ ...errors, [current.word.id]: '' }))
    try {
      const nextExamples = await onEnsureExamples(current.word.id)
      if (nextExamples.length > 0) {
        setGeneratedExamples((currentExamples) => ({
          ...currentExamples,
          [current.word.id]: nextExamples,
        }))
      }
    } catch {
      setExampleErrors((errors) => ({
        ...errors,
        [current.word.id]: '例句生成失败，请检查 AI 设置',
      }))
    } finally {
      setLoadingExamplesFor(null)
    }
  }

  if (!current) {
    return (
      <section className="empty-state">
        <p className="eyebrow">Review</p>
        <h2>今天已经背完了</h2>
        <button className="primary-action compact-action" onClick={() => void onLoadMoreWords()}>
          继续背词
        </button>
      </section>
    )
  }

  return (
    <div className="review-layout">
      <div className="review-topline">
        <span>
          {currentPosition} / {sessionTotal}
        </span>
        <div className="review-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <article className={`study-card ${revealed ? 'revealed' : ''}`} onClick={() => void toggleReveal()}>
        <div className="card-meta">
          <span>{current.card?.stage ?? 'new'}</span>
          <span>{current.word.pos ?? 'word'}</span>
        </div>

        <button
          className="icon-button sound-button"
          onClick={(event) => {
            event.stopPropagation()
            speak()
          }}
          aria-label="朗读单词"
        >
          <Volume2 size={20} />
        </button>

        <div className="word-face">
          <h2>{current.word.word}</h2>
          <p>{current.word.phonetic ?? 'tap to reveal'}</p>
        </div>

        {revealed ? (
          <div className="answer-face">
            <h3>
              <span>{current.word.pos ?? 'word'}</span>
              {current.word.cn}
            </h3>
            {examples.length ? (
              <ul>
                {examples.slice(0, 2).map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            ) : (
              <p className="example-placeholder">
                {loadingExamplesFor === current.word.id
                  ? '正在生成例句...'
                  : exampleErrors[current.word.id] || '启用 AI 后自动生成例句'}
              </p>
            )}
          </div>
        ) : null}
      </article>

      <div className="review-actions">
        <button className="again-action" onClick={() => void nextStep('again')} aria-label="没记住">
          <X size={28} />
        </button>
        <button className="good-action" onClick={() => void nextStep('good')} aria-label="记住了">
          <Check size={28} />
        </button>
      </div>
    </div>
  )
}
