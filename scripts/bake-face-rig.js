'use strict'
/**
 * bake-face-rig.js
 *
 * Bakes a canonical face rig GLB from the Avaturn donor avatar:
 *  - 6 face meshes (Head_Mesh, Teeth_Mesh, Tongue_Mesh, Eye_Mesh, Eyelash_Mesh, EyeAO_Mesh)
 *    each carrying its ARKit blendshape targets (and targetNames)
 *  - the full Avaturn skeleton (so consumers can reference LeftEye/RightEye/Head bones
 *    and the Armature skin with inverse-bind-matrices)
 *  - the `avaturn_animation` clip (canonical idle the SkeletalController looks for)
 *
 * Output: ../public/avatar-engine/face-rig.glb
 *
 * Source: /home/user/workspace/evolve-dnd/public/avatars/dm-default.glb
 *
 * The runtime engine (`merge-face-rig.ts`) consumes this asset, transplants
 * the face meshes onto a body-only Avaturn export by joint-name remap, and
 * appends `avaturn_animation` if the body GLB lacks it.
 */

const { NodeIO } = require('@gltf-transform/core')
const path = require('path')

const KEEP_MESHES = new Set([
  'Head_Mesh',
  'Teeth_Mesh',
  'Tongue_Mesh',
  'Eye_Mesh',
  'Eyelash_Mesh',
  'EyeAO_Mesh',
])

const KEEP_ANIM = 'avaturn_animation'

;(async () => {
  const io = new NodeIO()
  const srcPath = '/home/user/workspace/evolve-dnd/public/avatars/dm-default.glb'
  const outPath = path.resolve(__dirname, '..', 'public', 'avatar-engine', 'face-rig.glb')

  const doc = await io.read(srcPath)
  const root = doc.getRoot()

  // 1. Strip non-face meshes (and detach their node references)
  const meshesToDispose = []
  for (const mesh of root.listMeshes()) {
    if (!KEEP_MESHES.has(mesh.getName())) {
      meshesToDispose.push(mesh)
    }
  }
  // Detach mesh references from nodes first
  for (const node of root.listNodes()) {
    const m = node.getMesh()
    if (m && meshesToDispose.includes(m)) {
      node.setMesh(null)
    }
  }
  for (const mesh of meshesToDispose) {
    console.log(`Disposing mesh: ${mesh.getName()}`)
    mesh.dispose()
  }

  // 2. Strip non-essential animations
  for (const anim of root.listAnimations()) {
    if (anim.getName() !== KEEP_ANIM) {
      console.log(`Disposing anim: ${anim.getName()}`)
      anim.dispose()
    }
  }

  // 3. Prune orphan accessors/buffers/textures/materials (gltf-transform built-in)
  // We do this manually since we don't have the functions package.
  // Materials no longer referenced by any primitive
  const usedMaterials = new Set()
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      if (mat) usedMaterials.add(mat)
    }
  }
  for (const mat of root.listMaterials()) {
    if (!usedMaterials.has(mat)) mat.dispose()
  }

  // Textures no longer referenced
  const usedTextures = new Set()
  for (const mat of root.listMaterials()) {
    for (const tex of [
      mat.getBaseColorTexture(),
      mat.getNormalTexture(),
      mat.getEmissiveTexture(),
      mat.getOcclusionTexture(),
      mat.getMetallicRoughnessTexture(),
    ]) {
      if (tex) usedTextures.add(tex)
    }
  }
  for (const tex of root.listTextures()) {
    if (!usedTextures.has(tex)) tex.dispose()
  }

  // 4. Report what remains
  console.log('\n=== face-rig.glb contents ===')
  console.log('Meshes:')
  for (const m of root.listMeshes()) {
    const morphs = m.listPrimitives()[0]?.listTargets().length || 0
    console.log(`  ${m.getName()} morphs=${morphs}`)
  }
  console.log('Skins:')
  for (const s of root.listSkins()) {
    console.log(`  ${s.getName()} joints=${s.listJoints().length}`)
  }
  console.log('Animations:')
  for (const a of root.listAnimations()) {
    console.log(`  ${a.getName()}`)
  }

  await io.write(outPath, doc)
  const stat = require('fs').statSync(outPath)
  console.log(`\nWrote ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`)
})().catch((err) => { console.error(err); process.exit(1) })
