import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { text, gender } = (await req.json()) as { text: string; gender?: string }

  if (!text?.trim()) {
    return NextResponse.json({ error: 'text requis' }, { status: 400 })
  }

  const apiKey  = process.env.ELEVENLABS_API_KEY
  const voiceId = gender === 'male'
    ? process.env.ELEVENLABS_VOICE_MALE
    : process.env.ELEVENLABS_VOICE_FEMALE
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_turbo_v2_5'

  if (!apiKey || !voiceId) {
    return NextResponse.json({ error: 'Clé API ou Voice ID manquant' }, { status: 500 })
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  )

  if (!res.ok) {
    const detail = await res.text()
    console.error('[ElevenLabs timestamps]', res.status, detail)
    return NextResponse.json({ error: detail }, { status: res.status })
  }

  // Retourne { audio_base64, alignment: { characters, character_start_times_seconds, character_end_times_seconds } }
  const data = await res.json()
  return NextResponse.json(data)
}
