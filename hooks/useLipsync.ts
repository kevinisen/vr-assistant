'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Lipsync, VISEMES } from 'wawa-lipsync'

const VISEME_TO_VRM: Partial<Record<VISEMES, string>> = {
  [VISEMES.aa]: 'aa',
  [VISEMES.E]:  'ee',
  [VISEMES.I]:  'ih',
  [VISEMES.O]:  'oh',
  [VISEMES.U]:  'ou',
  [VISEMES.PP]: 'aa',
  [VISEMES.FF]: 'ih',
  [VISEMES.TH]: 'ih',
  [VISEMES.DD]: 'aa',
  [VISEMES.kk]: 'aa',
  [VISEMES.CH]: 'oh',
  [VISEMES.SS]: 'ih',
  [VISEMES.nn]: 'ih',
  [VISEMES.RR]: 'aa',
}

// Scale par slot VRM — ajuste si un viseme précis ouvre trop la bouche
// aa = beaucoup de consonnes (PP/DD/kk/RR) → on le réduit davantage
const VRM_SCALE: Record<string, number> = {
  aa: 0.40,
  ee: 0.50,
  ih: 0.60,
  oh: 0.55,
  ou: 0.55,
}

// Bouche fermée sous ce volume (évite les spikes début/fin d'audio)
const VOLUME_THRESHOLD = 0.025

export type VRMVisemeValues = Record<string, number>
const SILENT_VISEMES: VRMVisemeValues = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

export function useLipsync() {
  const lipsyncRef        = useRef<Lipsync | null>(null)
  const audioElRef        = useRef<HTMLAudioElement | null>(null)
  const animFrameRef      = useRef<number>(0)
  const mockAudioCtxRef   = useRef<AudioContext | null>(null)
  const mockOscillatorRef = useRef<OscillatorNode | null>(null)

  const isSpeakingRef = useRef(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const visemeValuesRef = useRef<VRMVisemeValues>({ ...SILENT_VISEMES })

  function setSpeaking(val: boolean) {
    isSpeakingRef.current = val
    setIsSpeaking(val)
  }

  const getLipsync = useCallback((): Lipsync => {
    if (!lipsyncRef.current) {
      lipsyncRef.current = new Lipsync({ fftSize: 256, historySize: 5 })
    }
    return lipsyncRef.current
  }, [])

  // Peak des valeurs VRM sur toute la durée de la phrase (pour le log)
  const visemePeakRef = useRef<VRMVisemeValues>({ ...SILENT_VISEMES })

  // ── Connexion audio réelle (ElevenLabs) ──────────────────────────────────
  const connectAudio = useCallback(
    (audioEl: HTMLAudioElement) => {
      if (audioElRef.current && audioElRef.current !== audioEl) {
        audioElRef.current.pause()
      }
      const lipsync = getLipsync()
      audioElRef.current = audioEl
      lipsync.connectAudio(audioEl)

      audioEl.addEventListener('play', () => {
        visemePeakRef.current = { ...SILENT_VISEMES } // remet à zéro au début
        setSpeaking(true)
      })
      audioEl.addEventListener('pause', () => {
        setSpeaking(false)
        audioElRef.current = null
        visemeValuesRef.current = { ...SILENT_VISEMES }
      })
      audioEl.addEventListener('ended', () => {
        setSpeaking(false)
        audioElRef.current = null
        visemeValuesRef.current = { ...SILENT_VISEMES }
        // Log des peaks visemes une seule fois à la fin de la phrase
        const peaks = visemePeakRef.current
        console.log(
          '[Lipsync] Peaks visemes (aa=bouche ouverte, ee/ih/oh/ou=autres)\n' +
          Object.entries(peaks)
            .sort(([, a], [, b]) => b - a)
            .map(([k, v]) => `  ${k}: ${v.toFixed(3)}`)
            .join('\n'),
        )
      })
    },
    [getLipsync],
  )

  // ── processFrame : appelé dans useFrame (R3F) ────────────────────────────
  const processFrame = useCallback(() => {
    const lipsync = lipsyncRef.current
    const audioEl = audioElRef.current

    if (!lipsync || !isSpeakingRef.current || !audioEl || audioEl.paused || audioEl.ended) return

    try {
      lipsync.processAudio()
      const features = lipsync.features
      if (!features) return

      if (features.volume < VOLUME_THRESHOLD) {
        visemeValuesRef.current = { ...SILENT_VISEMES }
        return
      }

      const avg       = lipsync.getAveragedFeatures()
      const dVolume   = features.volume   - avg.volume
      const dCentroid = features.centroid - avg.centroid
      const scores    = lipsync.adjustScoresForConsistency(
        lipsync.computeVisemeScores(features, avg, dVolume, dCentroid),
      )

      const newValues: VRMVisemeValues = { ...SILENT_VISEMES }
      for (const [visemeKey, vrmName] of Object.entries(VISEME_TO_VRM)) {
        const raw   = scores[visemeKey as VISEMES] ?? 0
        const scale = VRM_SCALE[vrmName ?? ''] ?? 0.5
        const score = raw * scale
        if (vrmName && score > 0) {
          newValues[vrmName] = Math.max(newValues[vrmName] ?? 0, score)
        }
      }
      visemeValuesRef.current = newValues

      // Mise à jour des peaks pour le log final
      for (const [k, v] of Object.entries(newValues)) {
        if (v > (visemePeakRef.current[k] ?? 0)) {
          visemePeakRef.current[k] = v
        }
      }
    } catch {
      // Audio pas encore prêt
    }
  }, [])

  // ── Mock speech ───────────────────────────────────────────────────────────
  const startMockSpeech = useCallback((durationMs = 5000) => {
    cancelAnimationFrame(animFrameRef.current)
    audioElRef.current = null   // ← évite que processFrame écrase les visemes mock

    const ctx = new AudioContext()
    mockAudioCtxRef.current = ctx
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(220, ctx.currentTime)
    osc.frequency.setValueCurveAtTime(
      new Float32Array([220, 280, 220, 320, 200, 260, 220, 300, 220]),
      ctx.currentTime,
      durationMs / 1000,
    )
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.setValueAtTime(0, ctx.currentTime + durationMs / 1000)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + durationMs / 1000)
    mockOscillatorRef.current = osc

    setSpeaking(true)
    const start = performance.now()

    const tick = (now: number) => {
      const t = now - start
      if (t >= durationMs) {
        visemeValuesRef.current = { ...SILENT_VISEMES }
        setSpeaking(false)
        void ctx.close()
        return
      }
      const burst = Math.abs(Math.sin(t * 0.003)) * Math.abs(Math.sin(t * 0.007 + 1))
      visemeValuesRef.current = {
        aa: Math.max(0, Math.sin(t * 0.012) * burst),
        oh: Math.max(0, Math.sin(t * 0.009 + 0.5) * burst),
        ee: Math.max(0, Math.sin(t * 0.015 + 1.2) * burst),
        ih: Math.max(0, Math.sin(t * 0.011 + 2.0) * burst),
        ou: Math.max(0, Math.sin(t * 0.008 + 0.8) * burst),
      }
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [])

  const stopSpeech = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current)
    audioElRef.current?.pause()
    audioElRef.current = null
    mockOscillatorRef.current?.stop()
    void mockAudioCtxRef.current?.close()
    mockOscillatorRef.current = null
    mockAudioCtxRef.current   = null
    visemeValuesRef.current   = { ...SILENT_VISEMES }
    setSpeaking(false)
  }, [])

  useEffect(() => () => { cancelAnimationFrame(animFrameRef.current) }, [])

  return { visemeValuesRef, isSpeaking, startMockSpeech, stopSpeech, connectAudio, processFrame }
}
