// merge-face-rig.ts
//
// Runtime in-browser merge of a canonical face rig onto a body-only Avaturn GLB.
//
// Why: Newer Avaturn exports often ship as body-only (no head/teeth/tongue/eye meshes
// and no ARKit blendshapes), making them unusable for lip-sync. Rather than ask each
// product to do a one-off Blender bake per avatar, the avatar-engine merges the donor
// face rig at load time so any product can drop a body-only GLB in and get a fully
// rigged talking avatar.
//
// Contract:
//   - Body skeleton wins: body bone bind poses and skinning are preserved.
//   - Face meshes are cloned from the donor and re-skinned to the body skeleton
//     by bone NAME. Donor inverse-bind-matrices are kept (face proportions follow
//     the donor's head bone positions, which closely match across Avaturn exports).
//   - Missing face-specific bones (LeftEye/RightEye) are cloned from the donor and
//     parented under the body's Head bone so eye blendshapes have somewhere to live.
//   - Mesh names (Head_Mesh, Teeth_Mesh, Tongue_Mesh, Eye_Mesh, Eyelash_Mesh,
//     EyeAO_Mesh) are preserved so the AVATURN_MESH_NAMES traversal in
//     AvatarCanvas continues to find them and apply visemes/blendshapes.
//   - The donor's `avaturn_animation` clip is appended to the body's clip list
//     if the body lacks it — SkeletalController binds clips to bones by name at
//     mix time, so the same clip works on any Avaturn skeleton.

import * as THREE from 'three'

/**
 * Structural GLTF type — we only depend on `scene` and `animations`, the two
 * fields that GLTFLoader populates. Avoids importing three/examples/jsm types
 * which aren't always resolvable depending on consumer TS configs.
 */
export interface LoadedGLTF {
  scene:      THREE.Group
  animations: THREE.AnimationClip[]
}

/** Canonical face mesh names produced by Avaturn / present in the donor face-rig.glb. */
export const FACE_MESH_NAMES = [
  'Head_Mesh',
  'Teeth_Mesh',
  'Tongue_Mesh',
  'Eye_Mesh',
  'Eyelash_Mesh',
  'EyeAO_Mesh',
] as const

/** Bones the donor face meshes depend on that may be missing from a body-only export. */
const FACE_ONLY_BONES = ['LeftEye', 'RightEye'] as const

/** Canonical idle clip name shipped in the donor face rig. */
export const CANONICAL_IDLE_CLIP = 'avaturn_animation'

/** Morph target the engine drives — its presence on the loaded body GLB indicates
 *  the body already carries the face rig and a runtime merge is not needed. */
const VISEME_PROBE_KEYS = ['viseme_aa', 'jawOpen', 'mouthSmileLeft']

/**
 * Returns true when the given (loaded) GLB scene already contains a SkinnedMesh
 * with ARKit-style blendshapes. When false, the caller should merge the donor
 * face rig before initialising the engine.
 */
export function hasFaceRig(scene: THREE.Object3D): boolean {
  let found = false
  scene.traverse((obj: THREE.Object3D) => {
    if (found) return
    const sm = obj as THREE.SkinnedMesh
    if (!sm.isSkinnedMesh) return
    const dict = sm.morphTargetDictionary
    if (!dict) return
    for (const key of VISEME_PROBE_KEYS) {
      if (key in dict) { found = true; return }
    }
  })
  return found
}

/** Map bone-name → bone for every Bone in the given scene. */
function buildBoneMap(scene: THREE.Object3D): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>()
  scene.traverse((obj: THREE.Object3D) => {
    const b = obj as THREE.Bone
    if (b.isBone) map.set(b.name, b)
  })
  return map
}

/**
 * Merge result:
 *   - mutated `body.scene` now carries the donor face meshes as children of the
 *     scene root, skinned to the body skeleton
 *   - mutated `body.animations` may have the donor `avaturn_animation` clip appended
 *
 * Caller passes already-loaded GLTF objects. The body GLTF is the canonical scene
 * we return (so React's useMemo/useLoader caching continues to work).
 */
export function mergeFaceRig(body: LoadedGLTF, donor: LoadedGLTF): LoadedGLTF {
  const bodyBones = buildBoneMap(body.scene)

  // 1. Add any missing face-only bones (LeftEye/RightEye) under body's Head.
  const headBone = bodyBones.get('Head')
  if (!headBone) {
    console.warn('[mergeFaceRig] body scene has no "Head" bone — eye bones cannot be parented. Face meshes will still merge but eye blendshapes may not move correctly.')
  } else {
    for (const name of FACE_ONLY_BONES) {
      if (bodyBones.has(name)) continue
      const donorBone = buildBoneMap(donor.scene).get(name)
      if (!donorBone) {
        console.warn(`[mergeFaceRig] donor missing expected bone "${name}" — skipping.`)
        continue
      }
      const cloned = donorBone.clone(false) as THREE.Bone
      // Preserve local TRS so the bone sits in the right place relative to Head.
      cloned.position.copy(donorBone.position)
      cloned.quaternion.copy(donorBone.quaternion)
      cloned.scale.copy(donorBone.scale)
      headBone.add(cloned)
      bodyBones.set(name, cloned)
    }
  }

  // 2. Collect donor face meshes and clone them onto the body.
  const donorMeshes: THREE.SkinnedMesh[] = []
  donor.scene.traverse((obj: THREE.Object3D) => {
    const sm = obj as THREE.SkinnedMesh
    if (sm.isSkinnedMesh && (FACE_MESH_NAMES as readonly string[]).includes(sm.name)) {
      donorMeshes.push(sm)
    }
  })

  if (donorMeshes.length === 0) {
    console.warn('[mergeFaceRig] donor scene contains no face meshes — nothing to merge.')
  }

  for (const donorMesh of donorMeshes) {
    // Clone the mesh (geometry + material refs shared, no skeleton clone).
    const cloned = donorMesh.clone() as THREE.SkinnedMesh
    cloned.name = donorMesh.name
    // Re-bind to body bones by name. Keep donor's boneInverses (the geometry was
    // bound to the donor's skeleton; reusing the donor inverses preserves shape).
    const donorJoints = donorMesh.skeleton.bones
    const remapped: THREE.Bone[] = []
    let missing = 0
    for (const donorBone of donorJoints) {
      const bodyBone = bodyBones.get(donorBone.name)
      if (bodyBone) {
        remapped.push(bodyBone)
      } else {
        // Use a fallback (root bone) and count. Avoids null entries which break SkinnedMesh.
        remapped.push(donorBone)
        missing++
      }
    }
    if (missing > 0) {
      console.warn(`[mergeFaceRig] ${donorMesh.name}: ${missing}/${donorJoints.length} joints had no body match (kept donor bone as fallback).`)
    }
    cloned.skeleton = new THREE.Skeleton(remapped, donorMesh.skeleton.boneInverses)
    cloned.bindMatrix.copy(donorMesh.bindMatrix)
    cloned.bindMatrixInverse.copy(donorMesh.bindMatrixInverse)
    // Frustum culling off — same reason as other Avaturn meshes (mixer drives bones
    // out of the rest-pose bounding sphere immediately).
    cloned.frustumCulled = false
    body.scene.add(cloned)
  }

  // 3. Append donor's idle clip if body lacks it.
  const hasCanonical = body.animations.some((c: THREE.AnimationClip) => c.name === CANONICAL_IDLE_CLIP)
  if (!hasCanonical) {
    const donorClip = donor.animations.find((c: THREE.AnimationClip) => c.name === CANONICAL_IDLE_CLIP)
    if (donorClip) {
      body.animations.push(donorClip.clone())
      console.info(`[mergeFaceRig] appended donor clip "${CANONICAL_IDLE_CLIP}" to body animations`)
    } else {
      console.warn(`[mergeFaceRig] donor lacks "${CANONICAL_IDLE_CLIP}" clip — no idle appended.`)
    }
  }

  return body
}
