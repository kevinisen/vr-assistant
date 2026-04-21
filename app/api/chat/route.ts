import { NextRequest, NextResponse } from 'next/server'
import { PERSONAS } from '@/lib/personas'

// ── Rate limiting par IP : 12 messages / jour ────────────────────────────────
const DAILY_LIMIT = 12
const ipCounters  = new Map<string, { count: number; resetAt: number }>()

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now     = Date.now()
  const entry   = ipCounters.get(ip)
  const midnight = new Date()
  midnight.setHours(24, 0, 0, 0)

  if (!entry || now >= entry.resetAt) {
    ipCounters.set(ip, { count: 1, resetAt: midnight.getTime() })
    return { allowed: true, remaining: DAILY_LIMIT - 1 }
  }

  if (entry.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 }
  }

  entry.count++
  return { allowed: true, remaining: DAILY_LIMIT - entry.count }
}

export interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

const SYSTEM_PROMPT = PERSONAS.yuki

// ── Groq (format OpenAI) ─────────────────────────────────────────────────────
async function callGroq(apiKey: string, model: string, messages: ChatMessage[]) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // 'model' → 'assistant' pour le format OpenAI
        ...messages.map((m) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.text })),
      ],
      temperature: 0.7,
      max_tokens: 600,
    }),
  })
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(apiKey: string, model: string, messages: ChatMessage[]) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
      }),
    },
  )
}

function extractGroqText(data: unknown): string {
  const d = data as { choices?: { message?: { content?: string } }[] }
  return d?.choices?.[0]?.message?.content ?? ''
}

function extractGeminiText(data: unknown): string {
  const d = data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return d?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ── Chaîne de fallback : Groq 20b → Groq 120b → Gemini ──────────────────────
// Modèles disponibles (utilisés pour la validation côté serveur)
const GROQ_MODELS   = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']
const GEMINI_MODELS = ['gemini-3.1-flash-lite-preview', 'gemini-2.0-flash-lite', 'gemini-2.0-flash']

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const { allowed } = checkRateLimit(ip)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Limite quotidienne atteinte (12 messages/jour). Reviens demain !' },
      { status: 429 },
    )
  }

  const { messages, modelId } = (await req.json()) as { messages: ChatMessage[]; modelId?: string }

  const groqKey     = process.env.GROQ_API_KEY
  const geminiKey   = process.env.GEMINI_API_KEY
  const groqPrimary = process.env.GROQ_MODEL_PRIMARY  ?? 'openai/gpt-oss-120b'
  const groqFallback = process.env.GROQ_MODEL_FALLBACK ?? 'openai/gpt-oss-20b'
  const geminiModel = process.env.GEMINI_MODEL_ID     ?? 'gemini-2.0-flash-lite'

  const t0 = Date.now()

  // ── Modèle sélectionné manuellement ─────────────────────────────────────
  if (modelId) {
    if (GROQ_MODELS.includes(modelId) && groqKey) {
      const res = await callGroq(groqKey, modelId, messages)
      if (res.ok) {
        console.log(`[Chat] ${modelId} (sélectionné) → 200 en ${Date.now() - t0}ms`)
        return NextResponse.json({ text: extractGroqText(await res.json()) })
      }
      console.warn(`[Chat] ${modelId} → ${res.status}`)
    }
    if (GEMINI_MODELS.includes(modelId) && geminiKey) {
      const res = await callGemini(geminiKey, modelId, messages)
      if (res.ok) {
        console.log(`[Chat] ${modelId} (sélectionné) → 200 en ${Date.now() - t0}ms`)
        return NextResponse.json({ text: extractGeminiText(await res.json()) })
      }
    }
    return NextResponse.json({ error: `Modèle ${modelId} indisponible` }, { status: 503 })
  }

  // ── Chaîne de fallback automatique ──────────────────────────────────────
  // 1. Groq principal
  if (groqKey && groqKey !== 'REMPLACE_PAR_TA_CLEF_GROQ') {
    let res = await callGroq(groqKey, groqPrimary, messages)

    // 2. Groq fallback
    if (res.status === 503) {
      console.warn(`[Chat] ${groqPrimary} → 503, bascule sur ${groqFallback}`)
      res = await callGroq(groqKey, groqFallback, messages)
    }

    if (res.ok) {
      console.log(`[Chat] ${groqPrimary} (Groq) → 200 en ${Date.now() - t0}ms`)
      return NextResponse.json({ text: extractGroqText(await res.json()) })
    }
    console.warn(`[Chat] Groq → ${res.status}, bascule sur Gemini`)
  }

  // 3. Gemini — dernier recours
  if (!geminiKey || geminiKey === 'REMPLACE_PAR_TA_CLEF_GEMINI') {
    return NextResponse.json({ error: 'Tous les modèles sont indisponibles' }, { status: 503 })
  }

  const geminiRes = await callGemini(geminiKey, geminiModel, messages)
  if (!geminiRes.ok) {
    const detail = await geminiRes.text()
    console.error(`[Chat] Gemini → ${geminiRes.status}`, detail)
    return NextResponse.json({ error: detail }, { status: geminiRes.status })
  }

  console.log(`[Chat] ${geminiModel} (Gemini fallback) → 200 en ${Date.now() - t0}ms`)
  return NextResponse.json({ text: extractGeminiText(await geminiRes.json()) })
}
