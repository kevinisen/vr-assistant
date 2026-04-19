'use client'

import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { VRMLoaderPlugin, VRM, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import type { VRMVisemeValues } from '@/hooks/useLipsync'

// ── Blink constants ──────────────────────────────────────────────────────────
const BLINK_MIN_MS = 2000
const BLINK_MAX_MS = 6000
const BLINK_HALF_DURATION_MS = 80 // half open → closed duration

function randomBlinkDelay() {
  return BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS)
}

export interface MoodData { mood: string; intensity: number }

interface Props {
  modelPath?: string
  visemeValuesRef: React.RefObject<VRMVisemeValues>
  isSpeaking: boolean
  processFrame: () => void
  onHeadY?: (y: number) => void
  moodData?: MoodData
}

export function FemaleAvatar({
  modelPath = '/models/female_avatar.vrm',
  visemeValuesRef,
  isSpeaking,
  processFrame,
  onHeadY,
  moodData,
}: Props) {
  const { scene } = useThree()
  const vrmRef = useRef<VRM | null>(null)

  // Blink state (all in refs → no re-renders)
  const blinkPhase = useRef<'idle' | 'closing' | 'opening'>('idle')
  const blinkProgress = useRef(0) // 0 → 1 within each phase
  const blinkTimer = useRef(0)    // ms since last blink
  const nextBlink = useRef(randomBlinkDelay())

  // ── Load VRM ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    loader.load(
      modelPath,
      (gltf) => {
        if (disposed) return

        const vrm = gltf.userData.vrm as VRM
        VRMUtils.rotateVRM0(vrm)

        // ── Pose de repos : bras le long du corps ────────────────────────
        // Math.PI / 2   = 90° → bras parfaitement verticaux
        // Math.PI / 2.2 = ~82° → légèrement écarté, plus naturel
        const L = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
        const R = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
        if (L) L.rotation.z = -Math.PI / 2.2
        if (R) R.rotation.z =  Math.PI / 2.2

        vrmRef.current = vrm
        scene.add(vrm.scene)

        // ── Auto-détection position tête ──────────────────────────────────
        if (onHeadY) {
          vrm.scene.updateWorldMatrix(true, true)
          const headNode = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
          if (headNode) {
            const worldPos = new THREE.Vector3()
            headNode.getWorldPosition(worldPos)
            onHeadY(worldPos.y)
          }
        }
      },
      undefined,
      (err) => console.error('[FemaleAvatar] VRM load error:', err),
    )

    return () => {
      disposed = true
      if (vrmRef.current) {
        scene.remove(vrmRef.current.scene)
        VRMUtils.deepDispose(vrmRef.current.scene)
        vrmRef.current = null
      }
    }
  }, [scene, modelPath])

  // ── Per-frame update ──────────────────────────────────────────────────────
  useFrame((state, delta) => {
    const vrm = vrmRef.current
    if (!vrm) return

    // 1. Process real audio lipsync (no-op for mock mode)
    processFrame()

    // 2. Advance VRM spring bones / physics
    vrm.update(delta)

    // 3. Respiration ──────────────────────────────────────────────────────
    // Deux sinus superposés : cycle principal (4s) + micro-variation (7s)
    // → donne une respiration légèrement irrégulière, plus naturelle
    const t = state.clock.elapsedTime
    const breath = Math.sin(t * (Math.PI / 2)) * 0.6          // ~4s / cycle
                 + Math.sin(t * (Math.PI / 3.5)) * 0.15       // variation lente

    const chest   = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    const spine   = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine)
    const shoulderL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
    const shoulderR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
    const neck    = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck)

    // Poitrine : soulèvement principal
    if (chest)    chest.rotation.x    = breath *  0.012
    // Colonne : légère ondulation
    if (spine)    spine.rotation.x    = breath *  0.006
    // Épaules : montée subtile (rotation Z relative à la pose de repos)
    if (shoulderL) shoulderL.rotation.z = -Math.PI / 2.2 + breath * -0.018
    if (shoulderR) shoulderR.rotation.z =  Math.PI / 2.2 + breath *  0.018
    // Tête : micro-inclinaison (donne vie sans être distracting)
    if (neck)     neck.rotation.x     = breath *  0.008

    // 4. Blink animation ─────────────────────────────────────────────────
    const deltaMs = delta * 1000

    if (blinkPhase.current === 'idle') {
      blinkTimer.current += deltaMs
      if (blinkTimer.current >= nextBlink.current) {
        blinkPhase.current = 'closing'
        blinkProgress.current = 0
      }
    }

    if (blinkPhase.current === 'closing') {
      blinkProgress.current = Math.min(
        1,
        blinkProgress.current + deltaMs / BLINK_HALF_DURATION_MS,
      )
      vrm.expressionManager?.setValue('blink', blinkProgress.current)
      if (blinkProgress.current >= 1) {
        blinkPhase.current = 'opening'
        blinkProgress.current = 0
      }
    }

    if (blinkPhase.current === 'opening') {
      blinkProgress.current = Math.min(
        1,
        blinkProgress.current + deltaMs / BLINK_HALF_DURATION_MS,
      )
      vrm.expressionManager?.setValue('blink', 1 - blinkProgress.current)
      if (blinkProgress.current >= 1) {
        vrm.expressionManager?.setValue('blink', 0)
        blinkPhase.current = 'idle'
        blinkTimer.current = 0
        nextBlink.current = randomBlinkDelay()
      }
    }

    // 5. Apply mood expression ───────────────────────────────────────────
    const MOOD_EXPRESSIONS = ['neutral', 'joy', 'fun', 'angry', 'sorrow', 'surprised']
    
    // On parcourt toutes les expressions possibles
    for (const expr of MOOD_EXPRESSIONS) {
      if (expr === 'neutral') continue // Pas de blendshape "neutral" à appliquer
      
      // Si cette expression est celle demandée, on applique l'intensité
      if (moodData && moodData.mood === expr) {
        vrm.expressionManager?.setValue(expr, moodData.intensity)
      } else {
        // Sinon, on remet l'expression à 0 pour éviter qu'elles ne s'accumulent
        vrm.expressionManager?.setValue(expr, 0)
      }
    }

    // 6. Apply lipsync visemes ───────────────────────────────────────────
    const visemes = visemeValuesRef.current
    if (isSpeaking) {
      vrm.expressionManager?.setValue('aa', visemes.aa ?? 0)
      vrm.expressionManager?.setValue('ih', visemes.ih ?? 0)
      vrm.expressionManager?.setValue('ou', visemes.ou ?? 0)
      vrm.expressionManager?.setValue('ee', visemes.ee ?? 0)
      vrm.expressionManager?.setValue('oh', visemes.oh ?? 0)
    } else {
      // Smoothly reset mouth to closed
      vrm.expressionManager?.setValue('aa', 0)
      vrm.expressionManager?.setValue('ih', 0)
      vrm.expressionManager?.setValue('ou', 0)
      vrm.expressionManager?.setValue('ee', 0)
      vrm.expressionManager?.setValue('oh', 0)
    }
  })

  return null
}
