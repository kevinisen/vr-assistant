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
  const { scene, camera } = useThree()
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

  // Mouse look-at (valeurs smoothées -1..1)
  const mouseNDC = useRef(new THREE.Vector2(0, 0))
  const mouseSmoothed = useRef(new THREE.Vector2(0, 0))
  const mouseWeight = useRef(1) // 1 = actif, 0 = désactivé (mood actif)

  // ── Mouse tracking ────────────────────────────────────────────────────────
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mouseNDC.current.x =  (e.clientX / window.innerWidth)  * 2 - 1
      mouseNDC.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => window.removeEventListener('mousemove', onMouseMove)
  }, [])

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

        // Caché jusqu'au premier frame pour éviter le flash T-pose
        vrm.scene.visible = false
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

    // 2. Mouse look-at — désactivé quand un mood est actif
    const hasMood = !!moodData // neutral inclus — désactive aussi la souris
    const targetWeight = hasMood ? 0 : 1
    // Fondu lent vers 0 (0.8/s) et retour lent vers 1 (0.5/s)
    const weightSpeed = hasMood ? 0.8 : 0.5
    mouseWeight.current += (targetWeight - mouseWeight.current) * Math.min(delta * weightSpeed, 1)

    mouseSmoothed.current.lerp(
      hasMood ? new THREE.Vector2(0, 0) : mouseNDC.current,
      Math.min(delta * 3, 1),
    )

    // 3. Advance VRM spring bones (lookAt appliqué ici automatiquement)
    vrm.update(delta)

    // Rendre visible après le premier frame (pose de repos déjà appliquée)
    if (!vrm.scene.visible) vrm.scene.visible = true

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
    const moodIn  = delta * 4   // entrée : ~0.25s
    const moodOut = delta * 1.5 // sortie : ~0.67s (retour smooth au neutre)
    surpriseOffset.current += ((moodData?.mood === 'surprised' ? 1 : 0) - surpriseOffset.current) * Math.min(moodData?.mood === 'surprised' ? moodIn : moodOut, 1)
    angryOffset.current    += ((moodData?.mood === 'angry'     ? 1 : 0) - angryOffset.current)    * Math.min(moodData?.mood === 'angry'     ? moodIn : moodOut, 1)
    happyOffset.current    += ((moodData?.mood === 'happy'     ? 1 : 0) - happyOffset.current)    * Math.min(moodData?.mood === 'happy'     ? moodIn : moodOut, 1)
    const s = surpriseOffset.current
    const a = angryOffset.current
    const h = happyOffset.current

    const mx = mouseSmoothed.current.x * mouseWeight.current
    const my = mouseSmoothed.current.y * mouseWeight.current

    // surprised : tête en arrière / angry : tête en avant / happy : pose chaleureuse
    if (neck) {
      neck.rotation.x = breath * 0.008 + s * -0.12 + a * 0.12 + my * -0.04
      neck.rotation.y = mx * 0.06
    }
    if (head) {
      head.rotation.x = s * -0.05 + a * 0.05 + h * -0.122 + my * -0.03
      head.rotation.y = mx * 0.04
      head.rotation.z = h * 0.1
    }

    // Yeux : suivi souris léger
    const leftEye  = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftEye)
    const rightEye = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightEye)
    const eyeY = Math.max(-0.090, Math.min(0.090, mx * 0.25))
    const eyeX = Math.max(-0.070, Math.min(0.070, my * -0.15))
    if (leftEye)  { leftEye.rotation.y  = eyeY ; leftEye.rotation.x  = eyeX }
    if (rightEye) { rightEye.rotation.y = eyeY ; rightEye.rotation.x = eyeX }

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
