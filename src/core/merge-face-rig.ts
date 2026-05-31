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
//     by bone NAME. Donor boneInverses are KEPT — the geometry was bound to the
//     donor skeleton so reusing the donor inverses preserves face proportions.
//     At render time: boneMatrix = bodyBone.matrixWorld × donorBoneInverse,
//     which maps each vertex from donor-bone-local space to body-world space,
//     landing the face at the correct offset from the body's Head bone regardless
//     of whatever Y-shift or rotation processGlb baked into the body Armature.
//   - Missing face-specific bones (LeftEye/RightEye) are cloned from the donor and
//     parented under the body's Head bone so eye blendshapes have somewhere to live.
//   - Mesh names (Head_Mesh, Teeth_Mesh, Tongue_Mesh, Eye_Mesh, Eyelash_Mesh,
//     EyeAO_Mesh) are preserved so the AVATURN_MESH_NAMES traversal in
//     AvatarCanvas continues to find them and apply visemes/blendshapes.
//   - The donor's `avaturn_animation` clip is appended to the body's clip list
//     if the body lacks it — SkeletalController binds clips to bones by name at
//     mix time, so the same clip works on any Avaturn skeleton.
//   - The body's pre-existing head skin (vertices in `avaturn_body` weighted to
//     the Head bone) is stripped so the donor `Head_Mesh` is the only visible
//     head geometry. Without this, body-only Avaturn exports z-fight a bald body
//     scalp against the donor face. See `stripBodyHeadRegion()` below.
//   - NOTE: processGlb (ACTS upload pipeline) also strips the head region
//     permanently at upload time — this runtime strip is a safety net for GLBs
//     that reach the browser without going through processGlb.

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

/** Body mesh names produced by Avaturn body-only exports. Triangles whose
 *  vertices are dominantly skinned to the Head bone (or its face descendants)
 *  are stripped from these meshes so the donor face isn't z-fighting the
 *  body's bald scalp. The neck is preserved because its vertices are weighted
 *  to the `Neck` bone, not `Head`. */
const BODY_MESH_NAMES = ['avaturn_body'] as const

/** Bones whose skinned vertices form the body's head region — stripped to make
 *  room for the donor face. Children of `Head` (LeftEye/RightEye if present in
 *  the body export) are also included by index lookup at runtime. */
const HEAD_REGION_BONE_NAMES = new Set(['Head'])

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
 * Remove triangles from a body SkinnedMesh whose vertices are dominantly skinned
 * to the head region (the `Head` bone and any of its descendant face bones).
 *
 * Without this, body-only Avaturn exports leave a bald head-shaped skin under
 * the donor face: the donor `Head_Mesh` covers most of it but the back of the
 * scalp pokes out through the donor hair/hood, and lip-sync looks weird because
 * mouth blendshapes only move the donor mesh while the body skull stays static.
 *
 * Algorithm:
 *   1. Walk the skeleton, mark joint indices that correspond to head-region
 *      bones (the `Head` bone plus everything parented under it, transitively).
 *   2. For each vertex, find its dominant joint (highest skin weight). If that
 *      joint is in the head region, mark the vertex as "head".
 *   3. Rebuild the index buffer keeping only triangles where NO vertex is
 *      "head". (Strict to avoid leaving partial polygons around the neckline.)
 *   4. Replace the geometry's index; original positions/skin attributes are
 *      untouched so the rest of the body skins identically.
 *
 * No-op if the mesh is unindexed, has no skin attributes, or no head bone is
 * present in the skeleton.
 */
function stripBodyHeadRegion(mesh: THREE.SkinnedMesh): { removed: number; kept: number } {
  const geom = mesh.geometry
  const index = geom.getIndex()
  const skinIndex = geom.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWeight = geom.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  if (!index || !skinIndex || !skinWeight) return { removed: 0, kept: 0 }

  const bones = mesh.skeleton.bones
  // Identify head-region bone indices: any bone whose name is in
  // HEAD_REGION_BONE_NAMES OR whose ancestor chain includes a Head bone.
  const headIdxSet = new Set<number>()
  // First, locate the actual Head bone object (case-sensitive name match).
  const headBones = bones.filter((b) => HEAD_REGION_BONE_NAMES.has(b.name))
  const isDescendantOfHead = (b: THREE.Object3D): boolean => {
    let cur: THREE.Object3D | null = b.parent
    while (cur) {
      if (headBones.includes(cur as THREE.Bone)) return true
      cur = cur.parent
    }
    return false
  }
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i]
    if (HEAD_REGION_BONE_NAMES.has(b.name) || isDescendantOfHead(b)) {
      headIdxSet.add(i)
    }
  }
  if (headIdxSet.size === 0) return { removed: 0, kept: index.count / 3 }

  // Per-vertex: is the dominant joint a head-region joint?
  const vertCount = skinIndex.count
  const isHeadVert = new Uint8Array(vertCount)
  const itemSize = skinIndex.itemSize // typically 4
  for (let v = 0; v < vertCount; v++) {
    let bestW = -1
    let bestJ = -1
    for (let k = 0; k < itemSize; k++) {
      const w = skinWeight.getComponent(v, k)
      if (w > bestW) {
        bestW = w
        bestJ = skinIndex.getComponent(v, k)
      }
    }
    if (bestJ >= 0 && headIdxSet.has(bestJ)) isHeadVert[v] = 1
  }

  // Filter triangles: drop if ANY vertex is head-dominant (strict).
  const oldIdx = index.array as ArrayLike<number>
  const triCount = index.count / 3
  const keepTris: number[] = []
  let removed = 0
  for (let t = 0; t < triCount; t++) {
    const a = oldIdx[t * 3], b = oldIdx[t * 3 + 1], c = oldIdx[t * 3 + 2]
    if (isHeadVert[a] || isHeadVert[b] || isHeadVert[c]) {
      removed++
    } else {
      keepTris.push(a, b, c)
    }
  }

  // Choose appropriate typed array for the new index based on max vertex index.
  const NewArrayCtor: Uint16ArrayConstructor | Uint32ArrayConstructor =
    vertCount > 65535 ? Uint32Array : Uint16Array
  const newIndex = new NewArrayCtor(keepTris)
  geom.setIndex(new THREE.BufferAttribute(newIndex, 1))
  // The bounding sphere/box are no longer accurate; recompute (cheap; once at load).
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  return { removed, kept: keepTris.length / 3 }
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

  // 1b. Ensure world matrices are up to date before any world-space queries.
  body.scene.updateMatrixWorld(true)

  // Diagnostic: confirm the Head bone is where processGlb placed it.
  if (headBone) {
    const headWorld = new THREE.Vector3()
    headBone.getWorldPosition(headWorld)
    console.info(
      `[mergeFaceRig] body Head worldY=${headWorld.y.toFixed(4)}` +
      ` (expected ~0.35 for processGlb-calibrated uploads)`
    )
  }

  // 2. Collect donor face meshes and clone them onto the body.
  const donorMeshes: THREE.SkinnedMesh[] = []
  donor.scene.traverse((obj: THREE.Object3D) => {
    const sm = obj as THREE.SkinnedMesh
    if (sm.isSkinnedMesh && (FACE_MESH_NAMES as readonly string[]).includes(sm.name)) {
      donorMeshes.push(sm)
    }
  })

  console.info(`[mergeFaceRig] found ${donorMeshes.length} donor face meshes to graft: ${donorMeshes.map(m=>m.name).join(', ')}`)
  if (donorMeshes.length === 0) {
    console.warn('[mergeFaceRig] donor scene contains no face meshes — nothing to merge.')
  }

  for (const donorMesh of donorMeshes) {
    // Clone the mesh (geometry + material refs shared, no skeleton clone).
    const cloned = donorMesh.clone() as THREE.SkinnedMesh
    cloned.name = donorMesh.name
    // Re-bind to body bones by name. Donor boneInverses are kept.
    //
    // At render time: boneMatrix_i = bodyBone.matrixWorld × donorBoneInverse_i
    // This maps each vertex from donor-bone-local space → body-world space,
    // landing the face at the same offset from the body's Head that it had
    // from the donor's Head — correct regardless of what Y-shift + rotation
    // processGlb baked into the body Armature.
    const donorJoints = donorMesh.skeleton.bones
    const remapped: THREE.Bone[] = []
    let missing = 0
    for (const donorBone of donorJoints) {
      const bodyBone = bodyBones.get(donorBone.name)
      if (bodyBone) {
        remapped.push(bodyBone)
      } else {
        // Fallback: keep donor bone (avoids null entries which break SkinnedMesh).
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

  // 3. Strip the body's pre-existing head skin so the donor face is the only
  //    visible head geometry. Only runs on meshes named in BODY_MESH_NAMES.
  body.scene.traverse((obj: THREE.Object3D) => {
    const sm = obj as THREE.SkinnedMesh
    if (!sm.isSkinnedMesh) return
    if (!(BODY_MESH_NAMES as readonly string[]).includes(sm.name)) return
    const { removed, kept } = stripBodyHeadRegion(sm)
    if (removed > 0) {
      console.info(`[mergeFaceRig] stripped ${removed} head-region triangles from "${sm.name}" (${kept} kept).`)
    }
  })

  // 4. Append donor's idle clip if body lacks it.
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
