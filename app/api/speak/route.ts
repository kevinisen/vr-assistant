import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { text } = (await req.json()) as { text: string }

  if (!text?.trim()) {
    return NextResponse.json({ error: 'text requis' }, { status: 400 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_turbo_v2_5'

  if (!apiKey || !voiceId) {
    return NextResponse.json({ error: 'Clé API ou Voice ID manquant' }, { status: 500 })
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    },
  )

  if (!res.ok) {
    const detail = await res.text()
    console.error('[ElevenLabs]', res.status, detail)
    return NextResponse.json({ error: detail }, { status: res.status })
  }

  const audio = await res.arrayBuffer()
  return new NextResponse(audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(audio.byteLength),
    },
  })
}
