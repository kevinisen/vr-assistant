import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Prevent Three.js / R3F from being bundled twice (server + client)
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei', '@pixiv/three-vrm'],
}

export default nextConfig
