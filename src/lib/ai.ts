import type { AiContentPayload, AiGeneratedWord, AppSettings, TodaySnapshot, WordEntry } from './types'

export const PROMPT_VERSION = 'v2'

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

const extractJson = (content: string) => {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return match?.[1]?.trim() ?? trimmed
}

const createChatCompletion = async (settings: AppSettings, prompt: string, temperature = 0.65) => {
  const baseUrl = settings.aiBaseUrl.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.aiApiKey.trim()}`,
    },
    body: JSON.stringify({
      model: settings.aiModel,
      temperature,
      messages: [
        {
          role: 'system',
          content: '你是中文用户的英语单词学习助手。所有回答必须是合法 JSON，不要输出 markdown 或额外解释。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`AI 请求失败：${response.status}`)
  }

  const data = (await response.json()) as ChatCompletionResponse
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 响应为空')
  return JSON.parse(extractJson(content)) as unknown
}

const formatSummaryWord = (word: WordEntry) => {
  const pos = word.pos ? `${word.pos} ` : ''
  return `${word.word}（${pos}${word.cn}）`
}

const formatSummaryWords = (words: WordEntry[]) => {
  if (words.length === 0) return '无'
  return words.slice(0, 12).map(formatSummaryWord).join('、')
}

export const buildMarkdownSummary = (snapshot: TodaySnapshot, payload: AiContentPayload) => {
  const studied = snapshot.completedTodayCount
  const remembered = snapshot.rememberedTodayCount
  const rememberRate = studied === 0 ? 0 : Math.round((remembered / studied) * 100)
  const weakWords = snapshot.weakWords.slice(0, 5).map((word) => `- ${word.word}: ${word.cn}`)
  const examples = payload.entries
    .flatMap((entry) => entry.examples.slice(0, 1).map((example) => `- ${example}`))
    .slice(0, 5)

  return [
    `# ${snapshot.dateKey} 背词小结`,
    '',
    `今天完成 **${studied}** 次复习，记住 **${remembered}** 次，记住率 **${rememberRate}%**。`,
    '',
    '## 今日重点',
    ...payload.highlights.map((item) => `- ${item}`),
    '',
    '## 需要回看',
    ...(weakWords.length ? weakWords : ['- 暂无明显困难词']),
    '',
    '## 明日计划',
    ...payload.tomorrowPlan.map((item) => `- ${item}`),
    '',
    '## 例句摘录',
    ...(examples.length ? examples : ['- 今日还没有生成例句']),
  ].join('\n')
}

export const generateFallbackSummary = (snapshot: TodaySnapshot): AiContentPayload => {
  const studied = snapshot.completedTodayCount
  const remembered = snapshot.rememberedTodayCount
  const rememberRate = studied === 0 ? 0 : Math.round((remembered / studied) * 100)
  const wrongNames = snapshot.wrongWords.slice(0, 4).map((word) => word.word)

  const payload: AiContentPayload = {
    summaryText:
      studied === 0
        ? '今天还没有留下答题记录。等做完一轮后，小结才会更像你真实的学习状态。'
        : `今天记住了 ${remembered} 个判断，漏掉了 ${wrongNames.join('、') || '不多'}，整体记住率约 ${rememberRate}%。如果明天时间紧，先回看这些刚刚卡住的词，比继续加新词更稳。`,
    highlights: [
      `今日新词 ${snapshot.plannedNewWords.length} 个`,
      `待复习词 ${snapshot.dueWords.length} 个`,
      `补弱词 ${snapshot.weakWords.length} 个`,
      studied === 0 ? '尚未形成学习记录' : `完成复习 ${studied} 次`,
    ],
    tomorrowPlan: [
      '优先完成明天到期的复习词',
      '保持同一时段打开应用，减少中断',
      '对今天仍模糊的词，再看一遍中文释义和记忆提示',
    ],
    entries: snapshot.plannedNewWords.map((word) => ({
      wordId: word.id,
      memoryHint: word.memoryHint ?? `${word.word} 的核心意思是“${word.cn}”，先记中文主干，再结合场景理解。`,
      examples: word.examples ?? [],
    })),
  }

  return {
    ...payload,
    markdown: buildMarkdownSummary(snapshot, payload),
  }
}

export const generateAiSummary = async (
  snapshot: TodaySnapshot,
  settings: AppSettings,
): Promise<AiContentPayload> => {
  if (!settings.aiEnabled || !settings.aiApiKey.trim()) {
    return generateFallbackSummary(snapshot)
  }

  const payload = {
    new_words: formatSummaryWords(snapshot.plannedNewWords),
    review_words: formatSummaryWords(snapshot.reviewedWords),
    correct: snapshot.rememberedTodayCount,
    wrong: Math.max(0, snapshot.completedTodayCount - snapshot.rememberedTodayCount),
    wrong_words: formatSummaryWords(snapshot.wrongWords),
  }

  const prompt = `你是一个关心用户学习状态的助手，语气自然，不浮夸。

根据以下学习数据，写一段100-150字的中文学习小结：
- 今日新词：${payload.new_words}
- 复习词：${payload.review_words}
- 答对：${payload.correct}，答错：${payload.wrong}
- 错误词列表：${payload.wrong_words}

要求：
1. 简要说今天记住了多少、漏掉了哪几个（直接点名）
2. 如果错误词有规律（比如都是动词、都是长词），点出来
3. 最后一句话是真实的提醒或观察，不要程式化鼓励，语气像一个认识user的人，不是机器
4. 口语化，不要分点，写成自然段落
5. 不超过150字

输出严格 JSON，不要输出 markdown，不要额外解释。字段要求：
{
  "summaryText": "自然段小结"
}`

  const parsed = (await createChatCompletion(settings, prompt, 0.7)) as Partial<AiContentPayload>
  const fallback = generateFallbackSummary(snapshot)
  const normalized: AiContentPayload = {
    ...fallback,
    summaryText: typeof parsed.summaryText === 'string' && parsed.summaryText.trim() ? parsed.summaryText.trim() : fallback.summaryText,
  }

  return {
    ...normalized,
    markdown: buildMarkdownSummary(snapshot, normalized),
  }
}

export const generateAiWords = async (
  settings: AppSettings,
  context: {
    count: number
    existingWords: WordEntry[]
    recentAgainWords: WordEntry[]
  },
): Promise<AiGeneratedWord[]> => {
  if (!settings.aiEnabled || !settings.aiApiKey.trim() || context.count <= 0) return []

  const prompt = `请为一个中文用户生成今天要背的英语新词，输出严格 JSON 数组。
每个元素字段：
{
  "word": "英文单词或短语",
  "phonetic": "音标，可为空",
  "pos": "词性",
  "cn": "中文核心含义",
  "definition": "简明英文释义",
  "memoryHint": "一句中文记忆提示",
  "examples": ["英文例句1", "英文例句2"],
  "difficulty": "${settings.difficultyPreference}",
  "tags": ["1到3个英文标签"]
}
要求：
1. 生成 ${context.count} 个，不要重复 existingWords。
2. 难度偏好为 ${settings.difficultyPreference}。
3. 结合 recentAgainWords 避免过度跳跃，优先生成同主题或稍进阶词。
4. 不要输出 markdown，不要额外字段。
数据：
${JSON.stringify({
  existingWords: context.existingWords.slice(-120).map((word) => word.word),
  recentAgainWords: context.recentAgainWords.slice(0, 20).map((word) => ({
    word: word.word,
    cn: word.cn,
    tags: word.tags,
  })),
})}`

  const parsed = await createChatCompletion(settings, prompt, 0.62)
  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((item): item is AiGeneratedWord => {
      const candidate = item as Partial<AiGeneratedWord>
      return Boolean(candidate.word && candidate.cn && candidate.definition && candidate.memoryHint)
    })
    .map((item) => ({
      ...item,
      examples: Array.isArray(item.examples) ? item.examples.slice(0, 2) : [],
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 3) : ['ai'],
      difficulty: item.difficulty ?? settings.difficultyPreference,
    }))
}

export const generateAiExamples = async (settings: AppSettings, word: WordEntry): Promise<string[]> => {
  if (!settings.aiEnabled || !settings.aiApiKey.trim()) return []

  const prompt = `请为中文用户生成英语单词例句，输出严格 JSON。
字段要求：
{
  "examples": ["英文例句1", "英文例句2"]
}
要求：
1. 只生成自然、实用、适合背单词的英文例句。
2. 每句 8 到 18 个英文单词。
3. 不要中文翻译，不要解释，不要 markdown，不要额外字段。
单词数据：
${JSON.stringify({
  word: word.word,
  pos: word.pos,
  cn: word.cn,
  definition: word.definition,
  tags: word.tags,
})}`

  const parsed = (await createChatCompletion(settings, prompt, 0.55)) as { examples?: unknown }
  if (!Array.isArray(parsed.examples)) return []

  return parsed.examples
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 2)
}

export const testAiConnection = async (settings: AppSettings) => {
  if (!settings.aiEnabled) {
    throw new Error('请先启用 AI')
  }

  if (!settings.aiApiKey.trim()) {
    throw new Error('请先填写 API Key')
  }

  const parsed = (await createChatCompletion(
    settings,
    '请只输出严格 JSON：{"ok":true}',
    0,
  )) as { ok?: unknown }

  if (parsed.ok !== true) {
    throw new Error('AI 响应格式异常')
  }

  return true
}
