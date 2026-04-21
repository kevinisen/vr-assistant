import * as THREE from 'three'
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

// Mixamo bone name → VRM HumanBoneName
const MIXAMO_TO_VRM: Record<string, VRMHumanBoneName> = {
  mixamorigHips:           VRMHumanBoneName.Hips,
  mixamorigSpine:          VRMHumanBoneName.Spine,
  mixamorigSpine1:         VRMHumanBoneName.Chest,
  mixamorigSpine2:         VRMHumanBoneName.UpperChest,
  mixamorigNeck:           VRMHumanBoneName.Neck,
  mixamorigHead:           VRMHumanBoneName.Head,
  mixamorigLeftShoulder:   VRMHumanBoneName.LeftShoulder,
  mixamorigLeftArm:        VRMHumanBoneName.LeftUpperArm,
  mixamorigLeftForeArm:    VRMHumanBoneName.LeftLowerArm,
  mixamorigLeftHand:       VRMHumanBoneName.LeftHand,
  mixamorigRightShoulder:  VRMHumanBoneName.RightShoulder,
  mixamorigRightArm:       VRMHumanBoneName.RightUpperArm,
  mixamorigRightForeArm:   VRMHumanBoneName.RightLowerArm,
  mixamorigRightHand:      VRMHumanBoneName.RightHand,
  mixamorigLeftUpLeg:      VRMHumanBoneName.LeftUpperLeg,
  mixamorigLeftLeg:        VRMHumanBoneName.LeftLowerLeg,
  mixamorigLeftFoot:       VRMHumanBoneName.LeftFoot,
  mixamorigRightUpLeg:     VRMHumanBoneName.RightUpperLeg,
  mixamorigRightLeg:       VRMHumanBoneName.RightLowerLeg,
  mixamorigRightFoot:      VRMHumanBoneName.RightFoot,
}

/**
 * Retargets a Mixamo AnimationClip to a VRM model.
 *
 * Key principle: Mixamo track values are ABSOLUTE local rotations (relative to
 * the skeleton's bind pose). VRM normalized bones expect rotations RELATIVE to
 * their rest pose (identity = T-pose). So for each track we compute:
 *   delta = inv(restRot) * keyframeRot
 * and apply that delta to the VRM normalized bone.
 *
 * @param clip       - AnimationClip from FBXLoader
 * @param fbxScene   - The THREE.Group returned by FBXLoader (contains the skeleton at rest pose)
 * @param vrm        - Target VRM instance
 */
export function retargetMixamoClip(
  clip: THREE.AnimationClip,
  fbxScene: THREE.Group,
  vrm: VRM,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = []

  for (const track of clip.tracks) {
    const dotIdx = track.name.lastIndexOf('.')
    const boneName = track.name.substring(0, dotIdx)
    const property = track.name.substring(dotIdx + 1)

    // Only handle rotation tracks
    if (property !== 'quaternion') continue

    const vrmBoneName = MIXAMO_TO_VRM[boneName]
    if (!vrmBoneName) continue

    const vrmBone = vrm.humanoid.getNormalizedBoneNode(vrmBoneName)
    if (!vrmBone) continue

    // Read the Mixamo bone's rest rotation (bind pose = before any animation)
    const mixamoBone = fbxScene.getObjectByName(boneName)
    if (!mixamoBone) continue

    const restQuat = mixamoBone.quaternion.clone()
    const restQuatInv = restQuat.clone().invert()

    const src = track.values as Float32Array
    const dst = new Float32Array(src.length)

    for (let i = 0; i < src.length; i += 4) {
      // delta = inv(rest) * current  →  identity when bone is at rest pose
      const q = new THREE.Quaternion(src[i], src[i + 1], src[i + 2], src[i + 3])
      q.premultiply(restQuatInv)
      dst[i]     = q.x
      dst[i + 1] = q.y
      dst[i + 2] = q.z
      dst[i + 3] = q.w
    }

    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${vrmBone.name}.quaternion`,
      track.times,
      dst,
    ))
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}
