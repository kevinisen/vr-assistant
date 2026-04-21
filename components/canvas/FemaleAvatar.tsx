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
const BLINK_HALF_DURATION_MS = 80

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

  // Blink state
  const blinkPhase = useRef<'idle' | 'closing' | 'opening'>('idle')
  const blinkProgress = useRef(0)
  const blinkTimer = useRef(0)
  const nextBlink = useRef(randomBlinkDelay())

  // Procedural mood animation state
  const surpriseOffset = useRef(0)
  const angryOffset = useRef(0)
  const happyOffset = useRef(0)

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

        const L = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
        const R = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
        if (L) L.rotation.z = -Math.PI / 2.2
        if (R) R.rotation.z =  Math.PI / 2.2

        vrmRef.current = vrm
        scene.add(vrm.scene)

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

    // 1. Process real audio lipsync
    processFrame()

    // 2. Advance VRM spring bones
    vrm.update(delta)

    // 3. Respiration ──────────────────────────────────────────────────────
    const t = state.clock.elapsedTime
    const breath = Math.sin(t * (Math.PI / 2)) * 0.6
                 + Math.sin(t * (Math.PI / 3.5)) * 0.15

    const chest    = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    const spine    = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine)
    const shoulderL = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
    const shoulderR = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
    const neck     = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck)
    const head     = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)

    if (chest)     chest.rotation.x     = breath *  0.012
    if (spine)     spine.rotation.x     = breath *  0.006
    if (shoulderL) shoulderL.rotation.z = -Math.PI / 2.2 + breath * -0.018
    if (shoulderR) shoulderR.rotation.z =  Math.PI / 2.2 + breath *  0.018

    // 4. Procedural mood animations ───────────────────────────────────────
    surpriseOffset.current += ((moodData?.mood === 'surprised' ? 1 : 0) - surpriseOffset.current) * Math.min(delta * 6, 1)
    angryOffset.current    += ((moodData?.mood === 'angry'     ? 1 : 0) - angryOffset.current)    * Math.min(delta * 6, 1)
    happyOffset.current    += ((moodData?.mood === 'happy'     ? 1 : 0) - happyOffset.current)    * Math.min(delta * 6, 1)
    const s = surpriseOffset.current
    const a = angryOffset.current
    const h = happyOffset.current

    // surprised : tête en arrière / angry : tête en avant / happy : pose chaleureuse
    if (neck) neck.rotation.x = breath * 0.008 + s * -0.12 + a * 0.12
    if (head) {
      head.rotation.x = s * -0.05 + a * 0.05 + h * -0.122  // -7° (menton relevé)
      head.rotation.y = 0
      head.rotation.z = h * 0.1
    }

    // 5. Blink animation ─────────────────────────────────────────────────
    const deltaMs = delta * 1000

    if (blinkPhase.current === 'idle') {
      blinkTimer.current += deltaMs
      if (blinkTimer.current >= nextBlink.current) {
        blinkPhase.current = 'closing'
        blinkProgress.current = 0
      }
    }

    if (blinkPhase.current === 'closing') {
      blinkProgress.current = Math.min(1, blinkProgress.current + deltaMs / BLINK_HALF_DURATION_MS)
      vrm.expressionManager?.setValue('blink', blinkProgress.current)
      if (blinkProgress.current >= 1) {
        blinkPhase.current = 'opening'
        blinkProgress.current = 0
      }
    }

    if (blinkPhase.current === 'opening') {
      blinkProgress.current = Math.min(1, blinkProgress.current + deltaMs / BLINK_HALF_DURATION_MS)
      vrm.expressionManager?.setValue('blink', 1 - blinkProgress.current)
      if (blinkProgress.current >= 1) {
        vrm.expressionManager?.setValue('blink', 0)
        blinkPhase.current = 'idle'
        blinkTimer.current = 0
        nextBlink.current = randomBlinkDelay()
      }
    }

    // 6. Apply mood expression — réduit pendant la parole pour garder yeux/sourcils
    // mais laisser les visemes contrôler la bouche
    const MOOD_EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised']
    for (const expr of MOOD_EXPRESSIONS) {
      const active = moodData?.mood === expr
      vrm.expressionManager?.setValue(expr, active ? (isSpeaking ? 0.4 : 1.0) : 0)
    }

    // 7. Apply lipsync visemes ───────────────────────────────────────────
    const visemes = visemeValuesRef.current
    if (isSpeaking) {
      vrm.expressionManager?.setValue('aa', visemes.aa ?? 0)
      vrm.expressionManager?.setValue('ih', visemes.ih ?? 0)
      vrm.expressionManager?.setValue('ou', visemes.ou ?? 0)
      vrm.expressionManager?.setValue('ee', visemes.ee ?? 0)
      vrm.expressionManager?.setValue('oh', visemes.oh ?? 0)
    } else {
      vrm.expressionManager?.setValue('aa', 0)
      vrm.expressionManager?.setValue('ih', 0)
      vrm.expressionManager?.setValue('ou', 0)
      vrm.expressionManager?.setValue('ee', 0)
      vrm.expressionManager?.setValue('oh', 0)
    }
  })

  return null
}
