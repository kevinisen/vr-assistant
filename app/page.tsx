'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useLipsync } from '@/hooks/useLipsync'
import { useTimestampLipsync } from '@/hooks/useTimestampLipsync'
import { useChat } from '@/hooks/useChat'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import type { ChatMessage } from '@/app/api/chat/route'

const VrmExperience = dynamic(
  () => import('@/components/canvas/VrmExperience').then((m) => m.VrmExperience),
  { ssr: false },
)

const MODELS = [
  { id: 'openai/gpt-oss-120b',           label: 'GPT-OSS 120B (Groq)' },
  { id: 'openai/gpt-oss-20b',            label: 'GPT-OSS 20B (Groq)' },
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
]

const VRM_MODELS = [
  { path: '/models/male-assistant.vrm',      label: 'Male Assistant',    gender: 'male' },
  { path: '/models/female_assistant_1.vrm',  label: 'Female Assistant 1', gender: 'female' },
  { path: '/models/female_assistant_2.vrm',  label: 'Female Assistant 2', gender: 'female' },
  { path: '/models/female_assistant_3.vrm',  label: 'Female Assistant 3', gender: 'female' },
]

export default function Home() {
  // ── Lipsync (partagé par tous les modes) ────────────────────────────────
  const lipsync  = useLipsync()
  const tsTTS    = useTimestampLipsync({ visemeValuesRef: lipsync.visemeValuesRef })

  const anyoneSpeaking = lipsync.isSpeaking || tsTTS.isSpeaking

  // ── Model selector ───────────────────────────────────────────────────────
  const [selectedModelId, setSelectedModelId] = useState(MODELS[0].id)
  const [selectedModelPath, setSelectedModelPath] = useState(VRM_MODELS[0].path)
  const selectedGender = VRM_MODELS.find((m) => m.path === selectedModelPath)?.gender ?? 'female'

  // ── Mood ─────────────────────────────────────────────────────────────────
  const [moodData, setMoodData] = useState<{ mood: string; intensity: number } | undefined>()

  // ── Bulle de dialogue ────────────────────────────────────────────────────
  const [bubbleText, setBubbleText] = useState<string | null>(null)
  const pendingBubbleRef = useRef<string>('')
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Affiche la bulle dès que la voix démarre, la cache après 10s + reset mood
  useEffect(() => {
    if (anyoneSpeaking && pendingBubbleRef.current) {
      setBubbleText(pendingBubbleRef.current)
      pendingBubbleRef.current = ''
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = setTimeout(() => setBubbleText(null), 10000)
    }
    if (!anyoneSpeaking) {
      setMoodData(undefined)
    }
  }, [anyoneSpeaking])

  // ── Chat LLM ─────────────────────────────────────────────────────────────
  const [chatInput, setChatInput]   = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const chat = useChat({
    onResponse: (text) => tsTTS.speak(text, selectedGender),
    onDisplay: (text) => { pendingBubbleRef.current = text },
    onMood: (data) => setMoodData(data),
    selectedModelId,
  })

  useEffect(() => {
    if (showHistory) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages, showHistory])

  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [lastTranscript, setLastTranscript] = useState<string | null>(null)
  const voice = useVoiceInput({
    onTranscript: (text, { autoSend }) => {
      setLastTranscript(text)
      if (autoSend) {
        void chat.send(text)
      } else {
        setChatInput((prev) => (prev ? `${prev} ${text}` : text))
      }
    },
    onError: (msg) => setVoiceError(msg),
  })

  const chatBusy = chat.isThinking || tsTTS.isLoading || tsTTS.isSpeaking || voice.isRecording || voice.isTranscribing

  function handleChatSend() {
    if (!chatBusy && chatInput.trim()) {
      tsTTS.unlockSpeech()
      setVoiceError(null)
      void chat.send(chatInput)
      setChatInput('')
    }
  }

  function stopAll() {
    lipsync.stopSpeech()
    tsTTS.stop()
  }

  return (
    <main style={{
      position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 30%, #ffffff 0%, #f4f6ff 50%, #eef2ff 100%)',
    }}>

      {/* Canvas plein écran */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <VrmExperience
          visemeValuesRef={lipsync.visemeValuesRef}
          isSpeaking={anyoneSpeaking}
          processFrame={lipsync.processFrame}
          modelPath={selectedModelPath}
          moodData={moodData}
        />
      </div>

      {/* ── Bulle BD (top-right) ─────────────────────────────────────────── */}
      {bubbleText && (
        <div style={{ position: 'absolute', top: 24, right: 24, zIndex: 10, maxWidth: 320, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="speech-bubble">
            <p style={{ margin: 0, color: '#1e1e2e', fontSize: 15, fontWeight: 600, lineHeight: 1.55, fontFamily: 'Arial, sans-serif' }}>
              {bubbleText}
            </p>
          </div>
        </div>
      )}

      {/* ── Sélecteurs (top-left) ────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* LLM */}
        <select
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          style={{
            background: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(99,102,241,0.5)',
            borderRadius: 12,
            color: '#94a3b8',
            fontSize: 12,
            padding: '8px 12px',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id} style={{ background: '#0f172a' }}>
              {m.label}
            </option>
          ))}
        </select>

        {/* Modèle 3D */}
        <select
          value={selectedModelPath}
          onChange={(e) => setSelectedModelPath(e.target.value)}
          style={{
            background: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(99,102,241,0.5)',
            borderRadius: 12,
            color: '#94a3b8',
            fontSize: 12,
            padding: '8px 12px',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {VRM_MODELS.map((m) => (
            <option key={m.path} value={m.path} style={{ background: '#0f172a' }}>
              {m.label}
            </option>
          ))}
        </select>

        {/* ── Affichage du Mood ───────────────────────────────────────────── */}
        {moodData && (
          <div style={{
            background: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(99,102,241,0.5)',
            borderRadius: 12,
            color: '#94a3b8',
            fontSize: 12,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span>🎭 Mood : {moodData.mood}</span>
            <span style={{ opacity: 0.7 }}>({Math.round(moodData.intensity * 100)}%)</span>
          </div>
        )}
      </div>

      {/* ── Boutons de test Mood (right) ─────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 120, right: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <span style={{color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5}}>Test Animations</span>
        {['neutral', 'joy', 'fun', 'angry', 'sorrow', 'surprised'].map(mood => (
          <button
            key={mood}
            onClick={() => setMoodData({ mood, intensity: 1.0 })}
            style={{
              background: moodData?.mood === mood ? 'rgba(99,102,241,0.8)' : 'rgba(15, 23, 42, 0.55)',
              backdropFilter: 'blur(12px)',
              border: moodData?.mood === mood ? '1px solid rgba(129,140,248,1)' : '1px solid rgba(99,102,241,0.3)',
              borderRadius: 8,
              color: '#fff',
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all 0.2s',
              width: '100px',
              textAlign: 'center'
            }}
          >
            {mood}
          </button>
        ))}
      </div>

      {/* ── UI overlay ──────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, padding: '0 20px 28px',
      }}>

        {/* Statut */}
        <p style={{ color: voice.isRecording ? '#f87171' : '#64748b', fontSize: 12, margin: 0 }}>
          {voice.isRecording    ? '🎙 Enregistrement… (cliquez pour arrêter)'
           : voice.isTranscribing ? '⏳ Transcription…'
           : chat.isThinking    ? '🤔 Réflexion…'
           : tsTTS.isLoading    ? '⏳ Génération audio…'
           : anyoneSpeaking     ? '🗣 Parle…'
           : null}
        </p>

        {/* ── Chat input — hauteur fixe, semi-transparent ───────────────── */}
        <div style={{
          width: '100%', maxWidth: 520,
          background: 'rgba(15, 23, 42, 0.55)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: 18, border: '1px solid rgba(99,102,241,0.5)',
          overflow: 'hidden',
        }}>
          {/* Waveform micro */}
          {voice.isRecording && (
            <div style={{ padding: '8px 12px 0' }}>
              <VoiceWaveform analyserRef={voice.analyserRef} />
            </div>
          )}

          {/* Dernier transcript vocal */}
          {lastTranscript && !voice.isRecording && (
            <p style={{
              margin: 0, padding: '8px 16px 0',
              color: '#a5b4fc', fontSize: 12,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              🎙 {lastTranscript}
            </p>
          )}

          {/* Erreur */}
          {(chat.error || tsTTS.error || voiceError) && (
            <p style={{ color: '#f87171', fontSize: 11, margin: '4px 16px 0' }}>
              ⚠️ {chat.error ?? tsTTS.error ?? voiceError}
            </p>
          )}

          {/* Input bar */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleChatSend() }}
              disabled={chatBusy}
              placeholder={chatBusy ? '…' : 'Écris un message…'}
              style={{
                flex: 1, padding: '11px 16px', background: 'transparent',
                border: 'none', color: 'white', fontSize: 14, outline: 'none',
              }}
            />
            {/* Micro */}
            <button
              onClick={() => { tsTTS.unlockSpeech(); void voice.toggle() }}
              disabled={voice.isTranscribing || (chatBusy && !voice.isRecording)}
              title={voice.isRecording ? 'Arrêter' : 'Parler'}
              style={{
                padding: '11px 10px', background: 'transparent', border: 'none',
                color: voice.isRecording
                  ? '#f87171'
                  : voice.isTranscribing || chatBusy
                    ? '#334155'
                    : '#6366f1',
                cursor: voice.isTranscribing || chatBusy ? 'not-allowed' : 'pointer',
                fontSize: 16,
                animation: voice.isRecording ? 'mic-pulse 1s ease-in-out infinite' : undefined,
              }}
            >
              🎙
            </button>
            {/* Historique */}
            <button
              onClick={() => setShowHistory((v) => !v)}
              disabled={chat.messages.length === 0}
              title="Historique"
              style={{
                padding: '11px 10px', background: 'transparent', border: 'none',
                color: chat.messages.length === 0 ? '#334155' : '#6366f1',
                cursor: chat.messages.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: 15,
              }}
            >
              📜
            </button>
            {/* Stop */}
            {anyoneSpeaking && (
              <button
                onClick={stopAll}
                style={{
                  padding: '11px 12px', background: 'transparent', border: 'none',
                  color: '#f87171', cursor: 'pointer', fontSize: 14, fontWeight: 700,
                }}
              >
                ■
              </button>
            )}
            {/* Envoyer */}
            <button
              onClick={handleChatSend}
              disabled={chatBusy || !chatInput.trim()}
              style={{
                padding: '11px 16px', background: 'transparent', border: 'none',
                color: chatBusy || !chatInput.trim() ? '#374151' : '#6366f1',
                cursor: chatBusy || !chatInput.trim() ? 'not-allowed' : 'pointer',
                fontSize: 18,
              }}
            >
              ➤
            </button>
          </div>
        </div>

        {/* ── Tiroir historique (latéral droit) ─────────────────────────── */}
        {showHistory && (
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 300,
            background: 'rgba(9, 14, 26, 0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderLeft: '1px solid #1e293b',
            display: 'flex', flexDirection: 'column',
            zIndex: 10,
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 16px 12px', borderBottom: '1px solid #1e293b',
            }}>
              <span style={{ color: '#6366f1', fontWeight: 700, fontSize: 13 }}>
                Historique
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={chat.reset}
                  disabled={chat.messages.length === 0}
                  title="Réinitialiser"
                  style={{
                    background: 'transparent', border: 'none', fontSize: 14,
                    color: chat.messages.length === 0 ? '#374151' : '#475569',
                    cursor: chat.messages.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >↺</button>
                <button
                  onClick={() => setShowHistory(false)}
                  style={{
                    background: 'transparent', border: 'none',
                    color: '#475569', cursor: 'pointer', fontSize: 16,
                  }}
                >✕</button>
              </div>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '12px 12px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {chat.messages.length === 0 && (
                <p style={{ color: '#475569', fontSize: 13, textAlign: 'center', margin: '20px 0' }}>
                  Aucun message
                </p>
              )}
              {chat.messages.map((m, i) => (
                <MessageBubble key={i} message={m} />
              ))}
              {chat.isThinking && (
                <div style={{ alignSelf: 'flex-start' }}>
                  <Bubble color="#1e3a5f"><ThinkingDots /></Bubble>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}



      </div>
    </main>
  )
}

// ── Composants UI ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <Bubble color={isUser ? '#312e81' : '#1e3a5f'}>
        {message.text}
      </Bubble>
    </div>
  )
}

function Bubble({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: color, borderRadius: 12, padding: '8px 12px',
      maxWidth: '85%', color: 'white', fontSize: 13, lineHeight: 1.5,
    }}>
      {children}
    </div>
  )
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 16 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#93c5fd',
            animation: `thinking-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return <p style={{ color: '#f87171', fontSize: 11, margin: 0 }}>⚠️ {msg}</p>
}

function VoiceWaveform({ analyserRef }: { analyserRef: React.RefObject<AnalyserNode | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Plus de points = courbe plus précise
    const FFT_SIZE = 1024
    if (analyserRef.current) analyserRef.current.fftSize = FFT_SIZE
    const timeData = new Uint8Array(FFT_SIZE / 2)

    let rafId: number

    const draw = () => {
      rafId = requestAnimationFrame(draw)
      const analyser = analyserRef.current
      const W = canvas.width
      const H = canvas.height
      const mid = H / 2

      ctx.clearRect(0, 0, W, H)

      // Ligne centrale en pointillés discrets
      ctx.setLineDash([4, 6])
      ctx.lineWidth   = 1
      ctx.strokeStyle = 'rgba(148,163,184,0.2)'
      ctx.beginPath()
      ctx.moveTo(0, mid)
      ctx.lineTo(W, mid)
      ctx.stroke()
      ctx.setLineDash([])

      if (!analyser) return

      analyser.getByteTimeDomainData(timeData)

      // Courbe principale avec glow
      ctx.shadowBlur  = 8
      ctx.shadowColor = '#818cf8'
      ctx.lineWidth   = 2
      ctx.strokeStyle = '#818cf8'
      ctx.beginPath()

      for (let i = 0; i < timeData.length; i++) {
        const x = (i / (timeData.length - 1)) * W
        // Centre à mid, amplitude ±(H/2 - 2px de marge)
        const y = mid + ((timeData[i] - 128) / 128) * (mid - 2)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()

      // Deuxième passe, plus fine et plus claire, pour le relief
      ctx.shadowBlur  = 0
      ctx.lineWidth   = 1
      ctx.strokeStyle = 'rgba(165,180,252,0.45)'
      ctx.beginPath()
      for (let i = 0; i < timeData.length; i++) {
        const x = (i / (timeData.length - 1)) * W
        const y = mid + ((timeData[i] - 128) / 128) * (mid - 2)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [analyserRef])

  return (
    <canvas
      ref={canvasRef}
      width={960}
      height={48}
      style={{ display: 'block', width: '100%', height: 48, borderRadius: 6 }}
    />
  )
}
