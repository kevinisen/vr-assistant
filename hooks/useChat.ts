'use client'

import { useState, useCallback } from 'react'
import type { ChatMessage } from '@/app/api/chat/route'

export interface MoodData { mood: string; intensity: number }

interface UseChatOptions {
  onResponse: (text: string) => Promise<void>
  onDisplay?: (text: string) => void
  onMood?: (data: MoodData) => void
  selectedModelId?: string
}

export function useChat({ onResponse, onDisplay, onMood, selectedModelId }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = useCallback(
    async (userText: string) => {
      const text = userText.trim()
      if (!text) return

      setError(null)
      setIsThinking(true)

      const updated: ChatMessage[] = [...messages, { role: 'user', text }]
      setMessages(updated)

      try {
        const window = updated.slice(-12)

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: window, modelId: selectedModelId }),
        })

        if (!res.ok) {
          const { error: msg } = (await res.json()) as { error: string }
          throw new Error(msg ?? `Erreur ${res.status}`)
        }

        const { text: raw } = (await res.json()) as { text: string }

        // Parse dual-language JSON from persona (japanese + english + mood)
        let ttsText = raw
        let displayText = raw
        let mood = 'neutral' // VRM expression name
        let moodIntensity = 0.5
        try {
          const parsed = JSON.parse(raw) as { japanese?: string; english?: string; mood?: string; mood_intensity?: number }
          if (parsed.japanese)       ttsText       = parsed.japanese
          if (parsed.english)        displayText   = parsed.english
          if (parsed.mood)           mood          = parsed.mood
          if (parsed.mood_intensity) moodIntensity = parsed.mood_intensity
        } catch {
          // Regex fallback if JSON is truncated/malformed
          const jpMatch = raw.match(/"japanese"\s*:\s*"((?:[^"\\]|\\.)*)"/)
          const enMatch = raw.match(/"english"\s*:\s*"((?:[^"\\]|\\.)*)"/)
          const mdMatch = raw.match(/"mood"\s*:\s*"(\w+)"/)
          const miMatch = raw.match(/"mood_intensity"\s*:\s*([\d.]+)/)
          if (jpMatch?.[1]) ttsText       = jpMatch[1]
          if (enMatch?.[1]) displayText   = enMatch[1]
          if (mdMatch?.[1]) mood          = mdMatch[1]
          if (miMatch?.[1]) moodIntensity = parseFloat(miMatch[1])
        }

        onMood?.({ mood, intensity: moodIntensity })

        setMessages((prev) => [...prev, { role: 'model', text: displayText }])

        // Notifie la bulle (elle s'affichera quand la voix démarre)
        onDisplay?.(displayText)

        // Déclenche ElevenLabs Timestamps → lipsync de l'avatar
        await onResponse(ttsText)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue'
        setError(msg)
        console.error('[useChat]', msg)
      } finally {
        setIsThinking(false)
      }
    },
    [messages, onResponse, selectedModelId],
  )

  const reset = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, send, isThinking, error, reset }
}
