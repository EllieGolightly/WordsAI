import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { generateFallbackSummary } from './lib/ai'
import {
  addWordToToday,
  defaultSettings,
  ensureWordExamples,
  extendTodayPlan,
  exportProgress,
  generateTodaySummary,
  getLocalStorageDiagnostics,
  getLibraryWords,
  getPersistentStorageSupport,
  getReviewDeck,
  getSettings,
  getStatsSnapshot,
  getTodaySnapshot,
  importProgress,
  requestPersistentStorage,
  restoreLocalBackupSnapshot,
  saveSettings,
  saveLocalBackupSnapshot,
  snoozeJsonExportReminder,
  submitReview,
  syncTodayNewWordTarget,
  testAiSettings,
} from './lib/services'
import type {
  AiContentPayload,
  AppSettings,
  LibraryWord,
  LocalStorageDiagnostics,
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
  const navigate = useNavigate()
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
  const [storageDiagnostics, setStorageDiagnostics] = useState<LocalStorageDiagnostics | null>(null)
  const [needsSnapshotRestore, setNeedsSnapshotRestore] = useState(false)
  const [showExportReminder, setShowExportReminder] = useState(false)
  const toastTimer = useRef<number | undefined>(undefined)
  const settingsSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const checkedExportReminder = useRef(false)

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

  const refreshDiagnostics = useCallback(async () => {
    const diagnostics = await getLocalStorageDiagnostics()
    setStorageDiagnostics(diagnostics)
    return diagnostics
  }, [])

  const loadDashboard = useCallback(async (skipSnapshotRestore = false) => {
    setLoading(true)
    try {
      const preflight = await refreshDiagnostics()
      if (
        !skipSnapshotRestore &&
        !preflight.hasLearningData &&
        preflight.snapshot &&
        preflight.snapshot.cardsCount + preflight.snapshot.reviewLogsCount + preflight.snapshot.dailyPlansCount > 0
      ) {
        setNeedsSnapshotRestore(true)
        setLoading(false)
        return
      }

      const todaySnapshot = await getTodaySnapshot()
      const [reviewDeck, statsSnapshot, settingsSnapshot, storageSupport] = await Promise.all([
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
      const diagnostics = await refreshDiagnostics()
      if (!checkedExportReminder.current && diagnostics.hasLearningData && diagnostics.exportReminder.due) {
        checkedExportReminder.current = true
        setShowExportReminder(true)
      }
    } finally {
      setLoading(false)
    }
  }, [refreshDiagnostics])

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
    return payload
  }, [today])

  const onReview = async (wordId: string, grade: 'again' | 'good') => {
    setBusyLabel('保存中')
    try {
      await submitReview(wordId, grade)
      const completedLastCard = deck.length <= 1
      if (completedLastCard) {
        setBusyLabel('生成小结')
        await generateTodaySummary()
      }
      await refreshAll()
    } finally {
      setBusyLabel('')
    }
  }

  const onStartReview = async () => {
    setBusyLabel('准备中')
    try {
      if (deck.length === 0) {
        const result = await extendTodayPlan()
        await refreshAll()
        if (result.addedCount > 0) {
          showToast(`已准备 ${result.addedCount} 个新词`)
        } else {
          showToast(result.error || '暂时没有生成新词，请检查 AI 设置')
        }
      }
      navigate('/review')
    } finally {
      setBusyLabel('')
    }
  }

  const onLoadMoreWords = async () => {
    setBusyLabel('准备新词')
    try {
      const result = await extendTodayPlan()
      await refreshAll()
      if (result.addedCount > 0) {
        showToast(`已准备 ${result.addedCount} 个新词`)
      } else {
        showToast(result.error || '暂时没有生成新词，请检查 AI 设置')
      }
    } finally {
      setBusyLabel('')
    }
  }

  const onCopySummary = async () => {
    if (!today || !summaryPayload) return
    await navigator.clipboard.writeText(summaryPayload.summaryText)
    showToast('已复制')
  }

  const onSaveSettings = (partial: Partial<AppSettings>) => {
    const task = settingsSaveQueue.current.then(async () => {
      setBusyLabel('保存中…')
      try {
        const previous = await getSettings()
        const next = await saveSettings(partial)
        setSettings(next)

        if (previous.newWordsPerDay !== next.newWordsPerDay) {
          const result = await syncTodayNewWordTarget()
          await refreshAll()
          if (result.remainingCount < result.requestedCount) {
            showToast(result.error || `当前准备了 ${result.remainingCount} 个新词`)
          }
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '设置保存失败')
      } finally {
        setBusyLabel('')
      }
    })

    settingsSaveQueue.current = task.catch(() => undefined)
    return task
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
    setShowExportReminder(false)
    void refreshDiagnostics()
    showToast('备份已导出')
  }

  const onImport = async (file?: File | null) => {
    if (!file) return
    setBusyLabel('导入中')
    try {
      await importProgress(await file.text())
      await saveLocalBackupSnapshot()
      await refreshAll()
      void refreshDiagnostics()
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

  const onRestoreSnapshot = async () => {
    setBusyLabel('恢复中')
    try {
      await restoreLocalBackupSnapshot()
      setNeedsSnapshotRestore(false)
      await loadDashboard(true)
      showToast('已恢复本地快照')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '快照恢复失败')
    } finally {
      setBusyLabel('')
    }
  }

  const onContinueWithoutSnapshot = async () => {
    setNeedsSnapshotRestore(false)
    await loadDashboard(true)
  }

  const onSnoozeExportReminder = () => {
    snoozeJsonExportReminder()
    setShowExportReminder(false)
    void refreshDiagnostics()
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

  if (needsSnapshotRestore && storageDiagnostics?.snapshot) {
    return (
      <div className="recovery-screen">
        <section className="recovery-panel">
          <p className="eyebrow">Local Backup</p>
          <h1>发现可恢复的本地快照</h1>
          <p>
            当前 IndexedDB 看起来没有学习记录，但本机还有一份
            {new Date(storageDiagnostics.snapshot.createdAt).toLocaleString()} 的快照。
          </p>
          <div className="storage-metrics">
            <span>{storageDiagnostics.snapshot.cardsCount} 张卡片</span>
            <span>{storageDiagnostics.snapshot.reviewLogsCount} 次复习</span>
            <span>v{storageDiagnostics.snapshot.version}</span>
          </div>
          <div className="button-row">
            <button className="primary-action" onClick={() => void onRestoreSnapshot()} disabled={Boolean(busyLabel)}>
              恢复快照
            </button>
            <button className="secondary-action" onClick={() => void onContinueWithoutSnapshot()}>
              继续打开
            </button>
          </div>
        </section>
      </div>
    )
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

      {showExportReminder ? (
        <div className="backup-banner">
          <span>建议下载一份 JSON 备份，本地存储无法防止 Safari 站点数据被清除。</span>
          <button onClick={() => void onExport()}>导出</button>
          <button onClick={onSnoozeExportReminder}>稍后</button>
        </div>
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
                onStartReview={onStartReview}
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
                onLoadMoreWords={onLoadMoreWords}
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
                settings={settings}
                storageInfo={storageInfo}
                storageDiagnostics={storageDiagnostics}
                summaryPreview={summaryPayload?.summaryText ?? ''}
                busyLabel={busyLabel}
                aiTestResult={aiTestResult}
                onSave={onSaveSettings}
                onTestAi={onTestAi}
                onExport={onExport}
                onImport={onImport}
                onRequestStorage={onRequestStorage}
                onRestoreSnapshot={onRestoreSnapshot}
                onSnoozeExportReminder={onSnoozeExportReminder}
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
