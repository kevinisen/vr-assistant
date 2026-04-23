'use client'

import { useState, useEffect, useCallback } from 'react'

interface BackgroundManagerProps {
  initialBlur?: number
  initialBrightness?: number
  currentBackground?: string
}

export function BackgroundManager({
  initialBlur = 10,
  initialBrightness = 0.8,
  currentBackground,
}: BackgroundManagerProps) {
  const [slotA, setSlotA] = useState('')
  const [slotB, setSlotB] = useState('')
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A')
  const [blur] = useState(initialBlur)
  const [brightness] = useState(initialBrightness)

  // ── Crossfade (attend que l'image soit chargée avant de switcher) ─────────
  const setBackground = useCallback((path: string) => {
    const img = new window.Image()
    img.onload = () => {
      setActiveSlot(prev => {
        if (prev === 'A') { setSlotB(path); return 'B' }
        else              { setSlotA(path); return 'A' }
      })
    }
    img.src = path
  }, [])

  // ── Init : charge le premier background depuis l'API ──────────────────────
  useEffect(() => {
    fetch('/api/backgrounds')
      .then(r => r.json())
      .then(({ backgrounds }: { backgrounds: string[] }) => {
        if (backgrounds.length > 0) {
          setSlotA(backgrounds[0])
          setSlotB(backgrounds[0])
        }
      })
  }, [])

  // ── Réagit au changement externe ──────────────────────────────────────────
  useEffect(() => {
    if (currentBackground) setBackground(currentBackground)
  }, [currentBackground, setBackground])

  const bgStyle = (image: string): React.CSSProperties => ({
    position: 'absolute',
    inset: '-20px',
    backgroundImage: image ? `url(${image})` : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: `blur(${blur}px) brightness(${brightness})`,
    transition: 'opacity 0.8s ease-in-out',
  })

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
      <div style={{ ...bgStyle(slotA), opacity: activeSlot === 'A' ? 1 : 0 }} />
      <div style={{ ...bgStyle(slotB), opacity: activeSlot === 'B' ? 1 : 0 }} />
    </div>
  )
}
