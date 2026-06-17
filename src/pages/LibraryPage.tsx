import { Plus, Search } from 'lucide-react'
import type { LibraryWord } from '../lib/types'

export function LibraryPage({
  words,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onAddWordToToday,
}: {
  words: LibraryWord[]
  query: string
  filter: 'all' | 'learned' | 'unlearned'
  onQueryChange: (query: string) => void
  onFilterChange: (filter: 'all' | 'learned' | 'unlearned') => void
  onAddWordToToday: (wordId: string) => void
}) {
  return (
    <div className="page-stack library-page">
      <section className="library-toolbar">
        <label className="search-box">
          <Search size={18} />
          <input value={query} placeholder="搜索单词 / 中文 / 释义" onChange={(event) => onQueryChange(event.target.value)} />
        </label>
        <div className="segmented-control">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => onFilterChange('all')}>
            全部
          </button>
          <button className={filter === 'learned' ? 'active' : ''} onClick={() => onFilterChange('learned')}>
            已学
          </button>
          <button className={filter === 'unlearned' ? 'active' : ''} onClick={() => onFilterChange('unlearned')}>
            未学
          </button>
        </div>
      </section>

      <section className="word-list">
        {words.map((word) => (
          <article className="word-row" key={word.id}>
            <div className="word-main">
              <div>
                <strong>{word.word}</strong>
                <span>{word.phonetic ?? word.pos ?? 'word'}</span>
              </div>
              <p>{word.cn}</p>
              <small>{word.definition}</small>
              {word.memoryHint ? <em>{word.memoryHint}</em> : null}
            </div>
            <div className="word-side">
              <span className={`status-dot ${word.learned ? 'learned' : ''}`}>
                {word.learned ? word.stage ?? '已学' : word.source ?? 'seed'}
              </span>
              <button className="icon-button" onClick={() => onAddWordToToday(word.id)} aria-label="加入今日学习">
                <Plus size={18} />
              </button>
            </div>
          </article>
        ))}
        {!words.length ? <p className="empty-copy">没有匹配的词。</p> : null}
      </section>
    </div>
  )
}
