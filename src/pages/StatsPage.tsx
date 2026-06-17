import { TrendingUp } from 'lucide-react'
import type { RangeStats, StatsSnapshot } from '../lib/types'

function RangeCard({ range }: { range: RangeStats }) {
  return (
    <article className="range-card">
      <span>{range.label}</span>
      <strong>{range.rememberRate}%</strong>
      <p>
        {range.totalReviews} 次复习 · {range.activeDays} 天活跃 · {range.newCards} 个新卡
      </p>
    </article>
  )
}

export function StatsPage({ stats }: { stats: StatsSnapshot | null }) {
  if (!stats) return null
  const maxHeat = Math.max(...stats.heatmap.map((day) => day.totalReviews), 1)

  return (
    <div className="page-stack stats-page">
      <section className="stats-hero">
        <div>
          <p className="eyebrow">统计</p>
          <h2>{stats.streakDays} 天</h2>
          <p>连续学习</p>
        </div>
        <div className="stats-mini">
          <span>{stats.totalLearned} 已学</span>
          <span>{stats.todayDue} 到期</span>
        </div>
      </section>

      <div className="range-grid">
        <RangeCard range={stats.week} />
        <RangeCard range={stats.month} />
        <RangeCard range={stats.year} />
      </div>

      <section className="panel-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">35 days</p>
            <h3>练习热力</h3>
          </div>
          <TrendingUp size={20} />
        </div>
        <div className="heatmap-grid">
          {stats.heatmap.map((day) => {
            const level = day.totalReviews === 0 ? 0 : Math.ceil((day.totalReviews / maxHeat) * 4)
            return <span title={`${day.dateKey}: ${day.totalReviews} 次`} data-level={level} key={day.dateKey} />
          })}
        </div>
      </section>
    </div>
  )
}
