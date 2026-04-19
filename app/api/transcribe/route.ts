import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey || groqKey === 'REMPLACE_PAR_TA_CLEF_GROQ') {
    return NextResponse.json({ error: 'Clé Groq manquante' }, { status: 500 })
  }

  const formData = await req.formData()
  const audioFile = formData.get('file')
  if (!audioFile || !(audioFile instanceof Blob)) {
    return NextResponse.json({ error: 'Fichier audio manquant' }, { status: 400 })
  }

  const body = new FormData()
  body.append('file', audioFile, 'audio.webm')
  body.append('model', 'whisper-large-v3-turbo')
  body.append('response_format', 'json')

  const t0 = Date.now()
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}` },
    body,
  })

  if (!res.ok) {
    const detail = await res.text()
    console.error(`[Transcribe] Groq Whisper → ${res.status}`, detail)
    return NextResponse.json({ error: detail }, { status: res.status })
  }

  const data = (await res.json()) as { text: string }
  console.log(`[Transcribe] Whisper → "${data.text}" en ${Date.now() - t0}ms`)
  return NextResponse.json({ text: data.text })
}
