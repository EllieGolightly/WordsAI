import { Database, Download, Import, KeyRound, RotateCcw, TestTube2, Vault } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppSettings, LocalStorageDiagnostics } from '../lib/types'

const formatDateTime = (value?: string) => {
  if (!value) return '暂无'
  return new Date(value).toLocaleString()
}

const formatBytes = (value?: number) => {
  if (!value) return '0 KB'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function SettingsPage({
  settings,
  storageInfo,
  storageDiagnostics,
  summaryPreview,
  busyLabel,
  aiTestResult,
  onSave,
  onTestAi,
  onExport,
  onImport,
  onRequestStorage,
  onRestoreSnapshot,
  onSnoozeExportReminder,
}: {
  settings: AppSettings
  storageInfo: { supported: boolean; persisted: boolean }
  storageDiagnostics: LocalStorageDiagnostics | null
  summaryPreview: string
  busyLabel: string
  aiTestResult: { status: 'idle' | 'testing' | 'ok' | 'error'; message: string }
  onSave: (partial: Partial<AppSettings>) => void | Promise<void>
  onTestAi: (draft: AppSettings) => void
  onExport: () => void
  onImport: (file?: File | null) => void
  onRequestStorage: () => void
  onRestoreSnapshot: () => void
  onSnoozeExportReminder: () => void
}) {
  const [draft, setDraft] = useState(settings)
  const [newWordsInput, setNewWordsInput] = useState(String(settings.newWordsPerDay))
  const onSaveRef = useRef(onSave)
  const didMount = useRef(false)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }

    const timer = window.setTimeout(() => {
      void onSaveRef.current(draft)
    }, 650)

    return () => window.clearTimeout(timer)
  }, [draft])

  return (
    <div className="page-stack settings-page">
      <section className="panel-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Daily Plan</p>
            <h3>学习节奏</h3>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>每日新词</span>
            <input
              inputMode="numeric"
              min={0}
              max={40}
              type="number"
              value={newWordsInput}
              onChange={(event) => {
                const value = event.target.value
                setNewWordsInput(value)
                if (value === '') return
                const nextValue = Math.min(40, Math.max(0, Number(value)))
                if (Number.isFinite(nextValue)) {
                  setDraft((current) => ({ ...current, newWordsPerDay: nextValue }))
                }
              }}
              onBlur={() => {
                if (newWordsInput === '') {
                  setNewWordsInput(String(draft.newWordsPerDay))
                  return
                }
                const nextValue = Math.min(40, Math.max(0, Number(newWordsInput)))
                setNewWordsInput(String(nextValue))
                setDraft((current) => ({ ...current, newWordsPerDay: nextValue }))
              }}
            />
          </label>
          <label>
            <span>难度偏好</span>
            <select
              value={draft.difficultyPreference}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  difficultyPreference: event.target.value as AppSettings['difficultyPreference'],
                }))
              }
            >
              <option value="gentle">轻松</option>
              <option value="balanced">均衡</option>
              <option value="challenge">挑战</option>
            </select>
          </label>
          <label>
            <span>记忆算法</span>
            <select
              value={draft.schedulerType}
              onChange={(event) =>
                setDraft((current) => ({ ...current, schedulerType: event.target.value as AppSettings['schedulerType'] }))
              }
            >
              <option value="sm2">SM-2</option>
              <option value="fsrs">FSRS</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">AI</p>
            <h3>自带 Key</h3>
          </div>
          <KeyRound size={20} />
        </div>
        <label className="switch-card">
          <span>启用 AI 生成新词和小结</span>
          <input
            type="checkbox"
            checked={draft.aiEnabled}
            onChange={(event) => setDraft((current) => ({ ...current, aiEnabled: event.target.checked }))}
          />
        </label>
        <div className="form-grid single">
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={draft.aiApiKey}
              placeholder="sk-..."
              onChange={(event) => setDraft((current) => ({ ...current, aiApiKey: event.target.value }))}
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={draft.aiBaseUrl}
              onChange={(event) => setDraft((current) => ({ ...current, aiBaseUrl: event.target.value }))}
            />
          </label>
          <label>
            <span>Model</span>
            <input
              value={draft.aiModel}
              onChange={(event) => setDraft((current) => ({ ...current, aiModel: event.target.value }))}
            />
          </label>
        </div>
        <div className="button-row ai-test-row">
          <button
            className="secondary-action"
            disabled={aiTestResult.status === 'testing'}
            onClick={() => onTestAi(draft)}
          >
            <TestTube2 size={17} />
            {aiTestResult.status === 'testing' ? '测试中' : '测试连接'}
          </button>
          {aiTestResult.message ? (
            <p className={`ai-test-message ${aiTestResult.status}`}>{aiTestResult.message}</p>
          ) : null}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Daily Summary</p>
            <h3>小结预览</h3>
          </div>
        </div>
        <p className="summary-preview">{summaryPreview || '完成背词后会在这里预览今日小结。'}</p>
      </section>

      <section className="panel-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">Local First</p>
            <h3>数据与存储</h3>
          </div>
          <Database size={20} />
        </div>
        <p className="storage-copy">
          {storageInfo.supported
            ? storageInfo.persisted
              ? '浏览器已授予持久化，但 iOS Safari 仍可能在存储压力下清理站点数据。'
              : '可尝试申请持久化；在 iOS Safari 上它不是可靠保险，定期导出 JSON 才是最终兜底。'
            : '当前浏览器不支持持久化检测，请依赖本地快照和 JSON 备份。'}
        </p>
        {storageDiagnostics ? (
          <div className="storage-diagnostics">
            <div>
              <span>当前域名</span>
              <strong>{storageDiagnostics.origin}</strong>
            </div>
            <div>
              <span>IndexedDB</span>
              <strong>{storageDiagnostics.indexedDbAvailable ? '可用' : '异常'}</strong>
            </div>
            <div>
              <span>卡片 / 复习</span>
              <strong>
                {storageDiagnostics.counts.cards} / {storageDiagnostics.counts.reviewLogs}
              </strong>
            </div>
            <div>
              <span>计划 / AI 小结</span>
              <strong>
                {storageDiagnostics.counts.dailyPlans} / {storageDiagnostics.counts.aiContents}
              </strong>
            </div>
            <div>
              <span>最近快照</span>
              <strong>{formatDateTime(storageDiagnostics.snapshot?.createdAt)}</strong>
            </div>
            <div>
              <span>快照版本 / 大小</span>
              <strong>
                {storageDiagnostics.snapshot ? `v${storageDiagnostics.snapshot.version} / ${formatBytes(storageDiagnostics.snapshot.sizeBytes)}` : '暂无'}
              </strong>
            </div>
            <div>
              <span>最近导出</span>
              <strong>{formatDateTime(storageDiagnostics.exportReminder.lastExportedAt)}</strong>
            </div>
            <div>
              <span>导出提醒</span>
              <strong>{storageDiagnostics.exportReminder.due ? '建议导出' : formatDateTime(storageDiagnostics.exportReminder.nextReminderAt)}</strong>
            </div>
          </div>
        ) : null}
        {storageDiagnostics?.indexedDbError ? <p className="storage-warning">{storageDiagnostics.indexedDbError}</p> : null}
        {storageDiagnostics?.snapshotWriteError ? <p className="storage-warning">{storageDiagnostics.snapshotWriteError}</p> : null}
        <div className="button-row">
          <button className="secondary-action" onClick={onRequestStorage}>
            <Vault size={17} />
            持久化
          </button>
          <button className="secondary-action" onClick={onExport}>
            <Download size={17} />
            导出
          </button>
          <label className="secondary-action file-trigger">
            <Import size={17} />
            导入
            <input type="file" accept="application/json" onChange={(event) => void onImport(event.target.files?.[0])} />
          </label>
          {storageDiagnostics?.snapshot ? (
            <button className="secondary-action" onClick={onRestoreSnapshot}>
              <RotateCcw size={17} />
              恢复快照
            </button>
          ) : null}
          {storageDiagnostics?.exportReminder.due ? (
            <button className="secondary-action" onClick={onSnoozeExportReminder}>
              稍后提醒
            </button>
          ) : null}
        </div>
      </section>

      <p className="autosave-status" aria-live="polite">{busyLabel || '自动保存'}</p>
    </div>
  )
}
