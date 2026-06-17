import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { buildMarkdownSummary, generateFallbackSummary } from './lib/ai'
import {
  addWordToToday,
  defaultSettings,
  ensureWordExamples,
  exportProgress,
  getLibraryWords,
  getPersistentStorageSupport,
  getReviewDeck,
  getSettings,
  getStatsSnapshot,
  getTodaySnapshot,
  importProgress,
  requestPersistentStorage,
  saveSettings,
  submitReview,
  testAiSettings,
} from './lib/services'
import type {
  AiContentPayload,
  AppSettings,
  LibraryWord,
  ReviewDeckItem,
  StatsSnapshot,
  TodaySnapshot,
} from './lib/types'
import { applyPwaUpdate, subscribePwaUpdates } from './pwa'
import { LibraryPage } from './pages/LibraryPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatsPage } from './pages/StatsPage'
import { TodayPage } from './pages/TodayPage'

function App() {
  const [today, setToday] = useState<TodaySnapshot | null>(null)
  const [deck, setDeck] = useState<ReviewDeckItem[]>([])
  const [stats, setStats] = useState<StatsSnapshot | null>(null)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [libraryWords, setLibraryWords] = useState<LibraryWord[]>([])
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'learned' | 'unlearned'>('all')
  const [loading, setLoading] = useState(true)
  const [busyLabel, setBusyLabel] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [aiTestResult, setAiTestResult] = useState<{ status: 'idle' | 'testing' | 'ok' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  })
  const [needRefresh, setNeedRefresh] = useState(false)
  const [storageInfo, setStorageInfo] = useState({ supported: false, persisted: false })
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      setToast(null)
    }, 1900)
  }, [])

  const loadLibrary = useCallback(async () => {
    const words = await getLibraryWords(libraryQuery, libraryFilter)
    setLibraryWords(words)
  }, [libraryFilter, libraryQuery])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const [todaySnapshot, reviewDeck, statsSnapshot, settingsSnapshot, storageSupport] = await Promise.all([
        getTodaySnapshot(),
        getReviewDeck(),
        getStatsSnapshot(),
        getSettings(),
        getPersistentStorageSupport(),
      ])

      setToday(todaySnapshot)
      setDeck(reviewDeck)
      setStats(statsSnapshot)
      setSettings(settingsSnapshot)
      setStorageInfo(storageSupport)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDashboard(), loadLibrary()])
  }, [loadDashboard, loadLibrary])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadDashboard])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLibrary()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadLibrary])

  useEffect(() => {
    const unsubscribe = subscribePwaUpdates((refreshNeeded) => setNeedRefresh(refreshNeeded))
    return () => {
      unsubscribe()
    }
  }, [])

  const summaryPayload = useMemo(() => {
    if (!today) return null
    const payload = today.summary?.payload ?? generateFallbackSummary(today)
    return {
      ...payload,
      markdown: payload.markdown ?? buildMarkdownSummary(today, payload),
    }
  }, [today])

  const onReview = async (wordId: string, grade: 'again' | 'good') => {
    setBusyLabel('保存中')
    try {
      await submitReview(wordId, grade)
      await refreshAll()
    } finally {
      setBusyLabel('')
    }
  }

  const onCopySummary = async () => {
    if (!today || !summaryPayload) return
    await navigator.clipboard.writeText(summaryPayload.markdown ?? buildMarkdownSummary(today, summaryPayload))
    showToast('已复制')
  }

  const onSaveSettings = async (partial: Partial<AppSettings>) => {
    setBusyLabel('保存中')
    try {
      const next = await saveSettings(partial)
      setSettings(next)
      await refreshAll()
      showToast('设置已保存')
    } finally {
      setBusyLabel('')
    }
  }

  const onTestAi = async (draft: AppSettings) => {
    setAiTestResult({ status: 'testing', message: '正在测试连接...' })
    try {
      await testAiSettings(draft)
      setAiTestResult({ status: 'ok', message: 'AI 连接正常' })
      showToast('AI 连接正常')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 连接失败'
      setAiTestResult({ status: 'error', message })
      showToast(message)
    }
  }

  const onExport = async () => {
    const data = await exportProgress()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `wordsai-export-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    showToast('备份已导出')
  }

  const onImport = async (file?: File | null) => {
    if (!file) return
    setBusyLabel('导入中')
    try {
      await importProgress(await file.text())
      await refreshAll()
      showToast('数据已恢复')
    } finally {
      setBusyLabel('')
    }
  }

  const onRequestStorage = async () => {
    const granted = await requestPersistentStorage()
    setStorageInfo({ supported: storageInfo.supported, persisted: granted })
    showToast(granted ? '已申请持久化存储' : '浏览器未授予持久化')
  }

  const onAddWordToToday = async (wordId: string) => {
    await addWordToToday(wordId)
    await refreshAll()
    showToast('已加入今日')
  }

  const onEnsureExamples = async (wordId: string) => {
    const examples = await ensureWordExamples(wordId)
    if (examples.length > 0) {
      await refreshAll()
    }
    return examples
  }

  if (loading && !today) {
    return <div className="loading-screen">WordsAI 正在醒来</div>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">WordsAI</p>
          <h1>记忆温室</h1>
        </div>
        <span className="date-pill">{today?.dateKey ?? ''}</span>
      </header>

      {needRefresh ? (
        <button className="update-banner" onClick={() => void applyPwaUpdate()}>
          有新版本，点击更新
        </button>
      ) : null}

      <main className="page-viewport">
        <Routes>
          <Route
            path="/"
            element={
              <TodayPage
                today={today}
                summaryPayload={summaryPayload as AiContentPayload | null}
                onCopySummary={onCopySummary}
              />
            }
          />
          <Route
            path="/review"
            element={
              <ReviewPage
                deck={deck}
                onReview={onReview}
                onEnsureExamples={onEnsureExamples}
              />
            }
          />
          <Route path="/stats" element={<StatsPage stats={stats} />} />
          <Route
            path="/library"
            element={
              <LibraryPage
                words={libraryWords}
                query={libraryQuery}
                filter={libraryFilter}
                onQueryChange={setLibraryQuery}
                onFilterChange={setLibraryFilter}
                onAddWordToToday={onAddWordToToday}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                key={JSON.stringify(settings)}
                settings={settings}
                storageInfo={storageInfo}
                summaryPreview={summaryPayload?.markdown ?? ''}
                busyLabel={busyLabel}
                aiTestResult={aiTestResult}
                onSave={onSaveSettings}
                onTestAi={onTestAi}
                onExport={onExport}
                onImport={onImport}
                onRequestStorage={onRequestStorage}
              />
            }
          />
        </Routes>
      </main>

      <BottomNav />
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

export default App
