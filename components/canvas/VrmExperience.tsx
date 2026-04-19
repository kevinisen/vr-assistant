'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Html, useProgress } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FemaleAvatar } from './FemaleAvatar'
import type { VRMVisemeValues } from '@/hooks/useLipsync'
import type { MoodData } from './FemaleAvatar'

function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div style={{ color: '#ffd080', textAlign: 'center' }}>
        Chargement… {Math.round(progress)}%
      </div>
    </Html>
  )
}

// ── Repositionne la caméra sur la tête du modèle ─────────────────────────────
function CameraRig({ headY }: { headY: number }) {
  const { camera } = useThree()
  const controlsRef = useRef<any>(null)

  useEffect(() => {
    camera.position.set(0, headY + 0.11, 0.6)
    if (controlsRef.current) {
      controlsRef.current.target.set(0, headY + 0.06, 0)
      controlsRef.current.update()
    }
  }, [headY, camera])

  return (
    <OrbitControls
      ref={controlsRef}
      target={[0, headY + 0.06, 0]}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 1.8}
      minDistance={0.5}
      maxDistance={4}
      enablePan={false}
      enableRotate={false}
      enableZoom={false}
    />
  )
}

interface Props {
  visemeValuesRef: React.RefObject<VRMVisemeValues>
  isSpeaking: boolean
  processFrame: () => void
  modelPath?: string
  moodData?: MoodData
}

export function VrmExperience({ visemeValuesRef, isSpeaking, processFrame, modelPath, moodData }: Props) {
  const [headY, setHeadY] = useState(1.38)

  // Reset à la valeur par défaut lors du changement de modèle
  useEffect(() => { setHeadY(1.38) }, [modelPath])

  return (
    <Canvas
      camera={{ position: [0, 1.43, 0.6], fov: 28 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        gl.toneMapping         = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 0.85
      }}
    >
      {/* Ambiante légère pour éviter les ombres trop dures */}
      <ambientLight color="#ffffff" intensity={0.3} />

      {/* Portrait light : face au modèle, légèrement au-dessus, ciblée sur la tête */}
      <directionalLight
        position={[0, headY - 0.5, 3]}
        target-position={[0, headY, 0]}
        color={0xfff5e6}
        intensity={2.5}
      />


      <Suspense fallback={<Loader />}>
        <FemaleAvatar
          modelPath={modelPath}
          visemeValuesRef={visemeValuesRef}
          isSpeaking={isSpeaking}
          processFrame={processFrame}
          onHeadY={setHeadY}
          moodData={moodData}
        />
      </Suspense>

      <CameraRig headY={headY} />
    </Canvas>
  )
}
