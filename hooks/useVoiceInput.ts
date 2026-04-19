'use client'

import { useCallback, useRef, useState } from 'react'

export type VoiceInputState = 'idle' | 'recording' | 'transcribing'

interface UseVoiceInputOptions {
  onTranscript: (text: string, opts: { autoSend: boolean }) => void
  onError?: (msg: string) => void
  /** Silence duration before auto-send in ms (default 4000) */
  silenceDelay?: number
}

export function useVoiceInput({
  onTranscript,
  onError,
  silenceDelay = 2000,
}: UseVoiceInputOptions) {
  const [state, setState] = useState<VoiceInputState>('idle')

  const recorderRef   = useRef<MediaRecorder | null>(null)
  const chunksRef     = useRef<Blob[]>([])
  const streamRef     = useRef<MediaStream | null>(null)
  const audioCtxRef   = useRef<AudioContext | null>(null)
  const analyserRef   = useRef<AnalyserNode | null>(null)
  const rafRef        = useRef<number>(0)
  const autoStoppedRef = useRef(false)

  const stop = useCallback((auto = false) => {
    autoStoppedRef.current = auto
    cancelAnimationFrame(rafRef.current)
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }, [])

  const start = useCallback(async () => {
    if (state !== 'idle') return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // ── Web Audio ────────────────────────────────────────────────────────
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const source   = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize               = 1024
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      analyserRef.current = analyser

      // ── MediaRecorder ────────────────────────────────────────────────────
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      chunksRef.current   = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        cancelAnimationFrame(rafRef.current)
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        audioCtxRef.current?.close()
        audioCtxRef.current = null
        analyserRef.current = null

        const wasAuto = autoStoppedRef.current
        autoStoppedRef.current = false

        const blob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []

        if (blob.size < 1000) { setState('idle'); return }

        setState('transcribing')
        try {
          const form = new FormData()
          form.append('file', blob, 'audio.webm')
          const res  = await fetch('/api/transcribe', { method: 'POST', body: form })
          const data = (await res.json()) as { text?: string; error?: string }
          if (!res.ok || !data.text) {
            onError?.(data.error ?? 'Erreur de transcription')
          } else if (data.text.trim()) {
            onTranscript(data.text.trim(), { autoSend: wasAuto })
          }
        } catch {
          onError?.('Impossible de joindre le serveur de transcription')
        } finally {
          setState('idle')
        }
      }

      // ── Détection de silence ─────────────────────────────────────────────
      const freqData  = new Uint8Array(analyser.frequencyBinCount)
      let lastSoundAt = Date.now()
      const graceUntil = Date.now() + 1000

      const checkSilence = () => {
        if (recorderRef.current?.state !== 'recording') return
        analyser.getByteFrequencyData(freqData)
        const avg = freqData.reduce((s, v) => s + v, 0) / freqData.length
        if (avg > 8) lastSoundAt = Date.now()

        const now = Date.now()
        if (now > graceUntil && now - lastSoundAt > silenceDelay) {
          stop(true) // auto = true → déclenchera autoSend
          return
        }
        rafRef.current = requestAnimationFrame(checkSilence)
      }

      recorder.start()
      setState('recording')
      rafRef.current = requestAnimationFrame(checkSilence)

    } catch {
      onError?.('Accès au microphone refusé')
      setState('idle')
    }
  }, [state, onTranscript, onError, silenceDelay, stop])

  const toggle = useCallback(() => {
    if (state === 'idle')      return start()
    if (state === 'recording') return stop(true) // manuel → envoie quand même si non vide
  }, [state, start, stop])

  return {
    state,
    isRecording:    state === 'recording',
    isTranscribing: state === 'transcribing',
    analyserRef,
    toggle,
    start,
    stop,
  }
}
