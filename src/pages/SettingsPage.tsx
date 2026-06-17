import { Database, Download, Import, KeyRound, Save, TestTube2, Vault } from 'lucide-react'
import { useState } from 'react'
import type { AppSettings } from '../lib/types'

export function SettingsPage({
  settings,
  storageInfo,
  summaryPreview,
  busyLabel,
  aiTestResult,
  onSave,
  onTestAi,
  onExport,
  onImport,
  onRequestStorage,
}: {
  settings: AppSettings
  storageInfo: { supported: boolean; persisted: boolean }
  summaryPreview: string
  busyLabel: string
  aiTestResult: { status: 'idle' | 'testing' | 'ok' | 'error'; message: string }
  onSave: (partial: Partial<AppSettings>) => void
  onTestAi: (draft: AppSettings) => void
  onExport: () => void
  onImport: (file?: File | null) => void
  onRequestStorage: () => void
}) {
  const [draft, setDraft] = useState(settings)

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
              value={draft.newWordsPerDay}
              onChange={(event) => setDraft((current) => ({ ...current, newWordsPerDay: Number(event.target.value) }))}
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
            <p className="eyebrow">Notion Markdown</p>
            <h3>小结预览</h3>
          </div>
        </div>
        <pre className="markdown-preview">{summaryPreview || '# 今日小结\n\n完成背词后会在这里预览。'}</pre>
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
          {storageInfo.supported ? (storageInfo.persisted ? '浏览器已尽量保留本地数据。' : '可申请持久化，降低浏览器清理风险。') : '当前浏览器不支持持久化检测。'}
        </p>
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
        </div>
      </section>

      <button className="primary-action sticky-save" onClick={() => onSave(draft)}>
        <Save size={19} />
        {busyLabel || '保存设置'}
      </button>
    </div>
  )
}
