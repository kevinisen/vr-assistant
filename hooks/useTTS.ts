'use client'

import { useState, useCallback, useRef } from 'react'

interface UseTTSOptions {
  connectAudio: (audioEl: HTMLAudioElement) => void
}

// Cache en mémoire : même texte → même blob, pas de nouvel appel API
const audioCache = new Map<string, Blob>()

export function useTTS({ connectAudio }: UseTTSOptions) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentUrlRef = useRef<string | null>(null)

  const speak = useCallback(
    async (text: string) => {
      const key = text.trim()
      if (!key) return
      setIsLoading(true)
      setError(null)

      try {
        // Libère l'ancien ObjectURL si présent
        if (currentUrlRef.current) {
          URL.revokeObjectURL(currentUrlRef.current)
          currentUrlRef.current = null
        }

        // Vérifie le cache avant d'appeler l'API
        let blob = audioCache.get(key)
        if (!blob) {
          const res = await fetch('/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: key }),
          })
          if (!res.ok) {
            const body = await res.text()
            throw new Error(body)
          }
          blob = await res.blob()
          audioCache.set(key, blob)
        }

        const url = URL.createObjectURL(blob)
        currentUrlRef.current = url

        const audio = new Audio(url)
        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(url)
          currentUrlRef.current = null
        }, { once: true })

        connectAudio(audio)
        await audio.play()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue'
        setError(msg)
        console.error('[useTTS]', msg)
      } finally {
        setIsLoading(false)
      }
    },
    [connectAudio],
  )

  return { speak, isLoading, error }
}
