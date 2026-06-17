import { ClipboardCopy, Play } from 'lucide-react'
import type { AiContentPayload, TodaySnapshot } from '../lib/types'

export function TodayPage({
  today,
  summaryPayload,
  onCopySummary,
  onStartReview,
}: {
  today: TodaySnapshot | null
  summaryPayload: AiContentPayload | null
  onCopySummary: () => void
  onStartReview: () => Promise<void>
}) {
  if (!today) return null

  const remainingCount = today.newWords.length + today.dueWords.length + today.weakWords.length
  const target = Math.max(today.completedTodayCount + remainingCount, 1)
  const completionRate = Math.min(100, Math.round((today.completedTodayCount / target) * 100))
  const rememberRate =
    today.completedTodayCount === 0 ? 0 : Math.round((today.rememberedTodayCount / today.completedTodayCount) * 100)
  const summaryText =
    today.completedTodayCount === 0
      ? `新词 ${today.newWords.length} 个，复习 ${today.dueWords.length} 个。`
      : `完成 ${today.completedTodayCount} 次复习，记住率 ${rememberRate}%。明日优先复习到期词。`

  return (
    <div className="page-stack today-page">
      <section className="today-card">
        <div className="today-stats">
          <article>
            <strong>{today.newWords.length}</strong>
            <span>新词</span>
          </article>
          <article>
            <strong>{today.dueWords.length + today.weakWords.length}</strong>
            <span>复习</span>
          </article>
          <article>
            <strong>{today.completedTodayCount}</strong>
            <span>完成</span>
          </article>
        </div>

        <div className="minimal-progress" aria-label={`今日完成 ${completionRate}%`}>
          <span style={{ width: `${completionRate}%` }} />
        </div>

        <button className="primary-action" onClick={() => void onStartReview()}>
          <Play size={18} />
          {today.completedTodayCount > 0 ? '继续背词' : '开始背词'}
        </button>
      </section>

      {summaryPayload ? (
        <section className="summary-panel">
          <div className="section-title">
            <h3>今日小结</h3>
            <button className="text-action" onClick={onCopySummary}>
              <ClipboardCopy size={15} />
              复制
            </button>
          </div>
          <p>{summaryText}</p>
        </section>
      ) : null}
    </div>
  )
}
