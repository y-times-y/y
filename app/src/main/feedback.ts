import { app, ipcMain } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAnalyticsIdentity, trackAnalytics } from './analytics'

type FeedbackPayload = {
  message?: string
  category?: string
  context?: Record<string, unknown>
}

type FeedbackRecord = {
  id: string
  message: string
  category: string
  context?: Record<string, unknown>
  timestamp: string
  appVersion: string
  platform: NodeJS.Platform
  userId?: string
}

function feedbackDir(): string {
  return join(app.getPath('userData'), 'feedback')
}

function feedbackFile(): string {
  return join(feedbackDir(), 'feedback.jsonl')
}

function feedbackEndpoint(): string {
  return (
    process.env.Y_FEEDBACK_URL ||
    process.env.VITE_Y_FEEDBACK_URL ||
    process.env.NEXT_PUBLIC_Y_FEEDBACK_URL ||
    'https://ytimesy.com/api/feedback'
  ).trim()
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

async function saveLocal(record: FeedbackRecord): Promise<void> {
  await mkdir(feedbackDir(), { recursive: true })
  await appendFile(feedbackFile(), `${JSON.stringify(record)}\n`, 'utf-8')
}

async function sendRemote(record: FeedbackRecord): Promise<boolean> {
  const url = feedbackEndpoint()
  if (!url) return false
  if (!/^https:\/\//u.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//u.test(url)) {
    throw new Error('Feedback URL must be HTTPS, or localhost during development.')
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record)
  })
  if (!res.ok) throw new Error(`Feedback endpoint returned ${res.status}`)
  return true
}

async function submitFeedback(payload: FeedbackPayload): Promise<{ ok: boolean; stored: 'remote' | 'local'; error?: string }> {
  const message = cleanText(payload.message, 6000)
  if (!message) return { ok: false, stored: 'local', error: 'Write a message before sending feedback.' }
  const identity = await getAnalyticsIdentity()
  const record: FeedbackRecord = {
    id: randomUUID(),
    message,
    category: cleanText(payload.category, 80) || 'general',
    context: payload.context,
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: process.platform,
    userId: identity.userId
  }

  try {
    const remote = await sendRemote(record)
    if (!remote) await saveLocal(record)
    await trackAnalytics('feedback_submitted', {
      stored: remote ? 'remote' : 'local',
      category: record.category,
      messageLength: record.message.length
    })
    return { ok: true, stored: remote ? 'remote' : 'local' }
  } catch (err) {
    await saveLocal(record)
    await trackAnalytics('feedback_submitted', {
      stored: 'local',
      category: record.category,
      messageLength: record.message.length,
      remoteFailed: true
    })
    return { ok: true, stored: 'local', error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerFeedbackBricks(): void {
  ipcMain.handle('feedback:submit', (_event, payload?: FeedbackPayload) => submitFeedback(payload ?? {}))
}
