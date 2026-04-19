'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import type { VRMVisemeValues } from './useLipsync'

// ── Mapper universel Unicode → viseme VRM ───────────────────────────────────
// Aucune détection de langue requise : on travaille au niveau du caractère.

// Consonnes avec mouvement de lèvres visible (universel, toutes langues)
const CONSONANT_MAP: Record<string, string> = {
  // Bilabiales : lèvres se ferment (FR/EN/ES/DE/RU/JA romaji...)
  b: 'aa', p: 'aa', m: 'aa',
  // Labio-dentales : lèvre inférieure touche les dents
  f: 'ih', v: 'ih',
  // Semi-voyelles arrondies
  w: 'ou',
}

// Voyelles latines étendues (FR, EN, ES, DE, PT, IT, PL, RO, TR, VI...)
const LATIN_VOWEL_MAP: Record<string, string> = {
  // ── a ouvert ──────────────────────────────────────────────────────────────
  a: 'aa', à: 'aa', â: 'aa', á: 'aa', ä: 'aa', ã: 'aa', å: 'aa',
  ą: 'aa', ā: 'aa', ă: 'aa', æ: 'aa',
  // ── e mi-ouvert ───────────────────────────────────────────────────────────
  e: 'ee', é: 'ee', è: 'ee', ê: 'ee', ë: 'ee', ę: 'ee', ě: 'ee',
  ē: 'ee', ė: 'ee',
  // ── i fermé antérieur ─────────────────────────────────────────────────────
  i: 'ih', î: 'ih', ï: 'ih', í: 'ih', ì: 'ih', ī: 'ih', į: 'ih',
  ı: 'ih', y: 'ih', ý: 'ih',
  // ── o mi-ouvert postérieur ────────────────────────────────────────────────
  o: 'oh', ô: 'oh', ö: 'oh', ó: 'oh', ò: 'oh', ø: 'oh', õ: 'oh',
  ō: 'oh', ő: 'oh', œ: 'oh',
  // ── u fermé postérieur arrondi ────────────────────────────────────────────
  // Note : "u" français /y/ est une voyelle fermée antérieure arrondie,
  // visuellement proche de "ou" (lèvres arrondies) → même slot
  u: 'ou', ù: 'ou', û: 'ou', ü: 'ou', ú: 'ou', ū: 'ou', ů: 'ou',
  ű: 'ou', ų: 'ou',
}

// Voyelles cyrilliques (RU, UK, BG, SR, MK...)
const CYRILLIC_VOWEL_MAP: Record<string, string> = {
  а: 'aa', я: 'aa',
  э: 'ee', е: 'ee', є: 'ee',
  и: 'ih', і: 'ih', ї: 'ih', й: 'ih', ы: 'ih',
  о: 'oh', ё: 'oh',
  у: 'ou', ю: 'ou',
}

// Voyelles grecques
const GREEK_VOWEL_MAP: Record<string, string> = {
  α: 'aa', ά: 'aa',
  ε: 'ee', έ: 'ee', η: 'ee', ή: 'ee',
  ι: 'ih', ί: 'ih', ϊ: 'ih', ΐ: 'ih', υ: 'ih', ύ: 'ih', ϋ: 'ih', ΰ: 'ih',
  ο: 'oh', ό: 'oh', ω: 'oh', ώ: 'oh',
}

// Hiragana — chaque mora est mappé selon sa voyelle sous-jacente
// あ段=aa  い段=ih  う段=ou  え段=ee  お段=oh
const HIRAGANA_MAP: Record<string, string> = {
  // Voyelles pures
  あ: 'aa', い: 'ih', う: 'ou', え: 'ee', お: 'oh',
  // Ka-gyō
  か: 'aa', き: 'ih', く: 'ou', け: 'ee', こ: 'oh',
  // Sa-gyō
  さ: 'aa', し: 'ih', す: 'ou', せ: 'ee', そ: 'oh',
  // Ta-gyō
  た: 'aa', ち: 'ih', つ: 'ou', て: 'ee', と: 'oh',
  // Na-gyō
  な: 'aa', に: 'ih', ぬ: 'ou', ね: 'ee', の: 'oh',
  // Ha-gyō
  は: 'aa', ひ: 'ih', ふ: 'ou', へ: 'ee', ほ: 'oh',
  // Ma-gyō
  ま: 'aa', み: 'ih', む: 'ou', め: 'ee', も: 'oh',
  // Ya-gyō
  や: 'aa', ゆ: 'ou', よ: 'oh',
  // Ra-gyō
  ら: 'aa', り: 'ih', る: 'ou', れ: 'ee', ろ: 'oh',
  // Wa-gyō
  わ: 'aa', ゐ: 'ih', ゑ: 'ee', を: 'oh',
  // N (moraic nasal → mouvement bref de lèvres)
  ん: 'ih',
  // Ga-gyō (voiced)
  が: 'aa', ぎ: 'ih', ぐ: 'ou', げ: 'ee', ご: 'oh',
  // Za-gyō
  ざ: 'aa', じ: 'ih', ず: 'ou', ぜ: 'ee', ぞ: 'oh',
  // Da-gyō
  だ: 'aa', ぢ: 'ih', づ: 'ou', で: 'ee', ど: 'oh',
  // Ba-gyō
  ば: 'aa', び: 'ih', ぶ: 'ou', べ: 'ee', ぼ: 'oh',
  // Pa-gyō
  ぱ: 'aa', ぴ: 'ih', ぷ: 'ou', ぺ: 'ee', ぽ: 'oh',
  // Petits caractères (composantes de mora → on ignore le mouvement séparé)
  ぁ: 'aa', ぃ: 'ih', ぅ: 'ou', ぇ: 'ee', ぉ: 'oh',
  っ: 'ih', ゃ: 'aa', ゅ: 'ou', ょ: 'oh',
}

// Katakana — même logique que hiragana
const KATAKANA_MAP: Record<string, string> = {
  ア: 'aa', イ: 'ih', ウ: 'ou', エ: 'ee', オ: 'oh',
  カ: 'aa', キ: 'ih', ク: 'ou', ケ: 'ee', コ: 'oh',
  サ: 'aa', シ: 'ih', ス: 'ou', セ: 'ee', ソ: 'oh',
  タ: 'aa', チ: 'ih', ツ: 'ou', テ: 'ee', ト: 'oh',
  ナ: 'aa', ニ: 'ih', ヌ: 'ou', ネ: 'ee', ノ: 'oh',
  ハ: 'aa', ヒ: 'ih', フ: 'ou', ヘ: 'ee', ホ: 'oh',
  マ: 'aa', ミ: 'ih', ム: 'ou', メ: 'ee', モ: 'oh',
  ヤ: 'aa', ユ: 'ou', ヨ: 'oh',
  ラ: 'aa', リ: 'ih', ル: 'ou', レ: 'ee', ロ: 'oh',
  ワ: 'aa', ヲ: 'oh', ン: 'ih',
  ガ: 'aa', ギ: 'ih', グ: 'ou', ゲ: 'ee', ゴ: 'oh',
  ザ: 'aa', ジ: 'ih', ズ: 'ou', ゼ: 'ee', ゾ: 'oh',
  ダ: 'aa', ヂ: 'ih', ヅ: 'ou', デ: 'ee', ド: 'oh',
  バ: 'aa', ビ: 'ih', ブ: 'ou', ベ: 'ee', ボ: 'oh',
  パ: 'aa', ピ: 'ih', プ: 'ou', ペ: 'ee', ポ: 'oh',
  ァ: 'aa', ィ: 'ih', ゥ: 'ou', ェ: 'ee', ォ: 'oh',
  ッ: 'ih', ャ: 'aa', ュ: 'ou', ョ: 'oh',
  // Caractères étendus katakana (langues étrangères)
  ヴ: 'ou', ヷ: 'aa', ヸ: 'ih', ヹ: 'ee', ヺ: 'oh',
}

// Plages Unicode CJK (kanji, hanzi, hanja) — chaque caractère = 1 syllabe ouverte
function isCJK(cp: number): boolean {
  return (cp >= 0x4E00 && cp <= 0x9FFF)   // CJK Unified Ideographs
      || (cp >= 0x3400 && cp <= 0x4DBF)   // Extension A
      || (cp >= 0x20000 && cp <= 0x2A6DF) // Extension B
      || (cp >= 0xF900 && cp <= 0xFAFF)   // CJK Compatibility
}

// Fonction principale — aucune détection de langue
function charToViseme(char: string): string | null {
  const c  = char.toLowerCase()
  const cp = c.codePointAt(0) ?? 0

  if (HIRAGANA_MAP[char])     return HIRAGANA_MAP[char]!
  if (KATAKANA_MAP[char])     return KATAKANA_MAP[char]!
  if (isCJK(cp))              return 'aa'   // syllabe ouverte par défaut
  if (LATIN_VOWEL_MAP[c])     return LATIN_VOWEL_MAP[c]!
  if (CYRILLIC_VOWEL_MAP[c])  return CYRILLIC_VOWEL_MAP[c]!
  if (GREEK_VOWEL_MAP[c])     return GREEK_VOWEL_MAP[c]!
  if (CONSONANT_MAP[c])       return CONSONANT_MAP[c]!

  return null  // ponctuation, espaces, consonnes sans mouvement visible
}

// Intensité max par slot VRM
const VRM_MAX: Record<string, number> = {
  aa: 0.65,
  ee: 0.65,
  ih: 0.50,
  oh: 0.62,
  ou: 0.62,
}

const SILENT: VRMVisemeValues = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

interface Alignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

interface UseTimestampLipsyncOptions {
  visemeValuesRef: React.RefObject<VRMVisemeValues>
}

// Cache ElevenLabs
const tsCache = new Map<string, { audioBase64: string; alignment: Alignment }>()

export function useTimestampLipsync({ visemeValuesRef }: UseTimestampLipsyncOptions) {
  const [isLoading, setIsLoading]   = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const alignRef    = useRef<Alignment | null>(null)
  const rafRef      = useRef<number>(0)
  const uttRef      = useRef<SpeechSynthesisUtterance | null>(null)
  const startRef    = useRef<number>(0)
  const unlockedRef = useRef(false)

  // Doit être appelé sur un geste utilisateur — déverrouille Chrome
  const unlockSpeech = useCallback(() => {
    if (unlockedRef.current) return
    const silent = new SpeechSynthesisUtterance('.')
    silent.volume = 0
    silent.rate   = 10
    window.speechSynthesis.speak(silent)
    unlockedRef.current = true
    console.log('[TTS] Speech synthesis unlocked')
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    audioRef.current?.pause()
    audioRef.current = null
    alignRef.current = null
    if (uttRef.current) {
      window.speechSynthesis.cancel()
      uttRef.current = null
    }
    visemeValuesRef.current = { ...SILENT }
    setIsSpeaking(false)
  }, [visemeValuesRef])

  // ── Lipsync RAF basé sur les timestamps ElevenLabs ──────────────────────
  const startTimestampLipsync = useCallback((audio: HTMLAudioElement, alignment: Alignment) => {
    const tick = () => {
      if (!audio || audio.ended || audio.paused) return
      const t     = audio.currentTime
      const chars  = alignment.characters
      const starts = alignment.character_start_times_seconds
      const ends   = alignment.character_end_times_seconds

      let activeViseme: string | null = null
      let intensity = 0
      for (let i = 0; i < chars.length; i++) {
        if (t >= starts[i] && t < ends[i]) {
          const viseme = charToViseme(chars[i])
          if (viseme) {
            const progress = (t - starts[i]) / Math.max(ends[i] - starts[i], 0.001)
            intensity      = Math.sin(progress * Math.PI) * (VRM_MAX[viseme] ?? 0.5)
            activeViseme   = viseme
          }
          break
        }
      }
      const newValues: VRMVisemeValues = { ...SILENT }
      if (activeViseme && intensity > 0) newValues[activeViseme] = intensity
      visemeValuesRef.current = newValues
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [visemeValuesRef])

  // ── Fallback : voix navigateur + lipsync mock ────────────────────────────
  const speakBrowser = useCallback((key: string) => {
    const doSpeak = () => {
      const utt = new SpeechSynthesisUtterance(key)
      utt.lang  = 'fr-FR'
      utt.rate  = 1.0
      utt.pitch = 1.1

      const frVoice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith('fr'))
      if (frVoice) utt.voice = frVoice

      utt.onstart = () => {
        startRef.current = performance.now()
        setIsSpeaking(true)
        setIsLoading(false)
        const CHARS_PER_SEC = 13
        const chars = [...key].filter((c) => charToViseme(c) !== null)
        const estimatedDuration = (key.length / CHARS_PER_SEC) * 1000
        const tick = () => {
          const elapsed = performance.now() - startRef.current
          if (elapsed >= estimatedDuration + 500) return
          const idx    = Math.floor((elapsed / 1000) * CHARS_PER_SEC) % Math.max(chars.length, 1)
          const viseme = charToViseme(chars[idx] ?? 'a') ?? 'aa'
          const newValues: VRMVisemeValues = { ...SILENT }
          newValues[viseme] = Math.sin(((elapsed % 150) / 150) * Math.PI) * (VRM_MAX[viseme] ?? 0.5)
          visemeValuesRef.current = newValues
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }

      utt.onend = () => {
        cancelAnimationFrame(rafRef.current)
        visemeValuesRef.current = { ...SILENT }
        uttRef.current = null
        setIsSpeaking(false)
      }

      utt.onerror = (e) => {
        if (e.error === 'interrupted' || e.error === 'canceled') return
        cancelAnimationFrame(rafRef.current)
        visemeValuesRef.current = { ...SILENT }
        uttRef.current = null
        setIsSpeaking(false)
        setIsLoading(false)
      }

      uttRef.current = utt
      window.speechSynthesis.speak(utt)
    }

    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak()
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true })
    }
  }, [visemeValuesRef])

  // ── speak principal : ElevenLabs → fallback navigateur ──────────────────
  const speak = useCallback(
    async (text: string, gender?: string) => {
      const key = text.trim()
      if (!key) return

      stop()
      setIsLoading(true)
      setError(null)

      try {
        const cacheKey = `${gender ?? 'female'}:${key}`
        let cached = tsCache.get(cacheKey)
        if (!cached) {
          const res = await fetch('/api/speak-timestamps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: key, gender }),
          })
          if (!res.ok) throw new Error(await res.text())
          const data = await res.json() as { audio_base64: string; alignment: Alignment }
          cached = { audioBase64: data.audio_base64, alignment: data.alignment }
          tsCache.set(cacheKey, cached)
        }

        alignRef.current = cached.alignment
        const binary = atob(cached.audioBase64)
        const bytes  = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const url   = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
        const audio = new Audio(url)
        audioRef.current = audio

        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(url)
          cancelAnimationFrame(rafRef.current)
          visemeValuesRef.current = { ...SILENT }
          setIsSpeaking(false)
        }, { once: true })

        await audio.play()
        setIsSpeaking(true)
        setIsLoading(false)
        startTimestampLipsync(audio, cached.alignment)
      } catch (err) {
        console.warn('[TTS] ElevenLabs failed, fallback browser', err)
        speakBrowser(key)
      }
    },
    [visemeValuesRef, stop, startTimestampLipsync, speakBrowser],
  )

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    window.speechSynthesis.cancel()
  }, [])

  return { speak, isLoading, isSpeaking, error, stop, unlockSpeech }
}
