/**
 * interactive-gltf script base (author-facing ES module).
 * Served at /igltf-core/gltf-script.js — extend for behaviour scripts (scriptRole: behaviour):
 *   import { GlTFScript } from '/igltf-core/gltf-script.js'
 * Runtime injects global GLTF before your module loads.
 */

export class GlTFScript {
  constructor() {
    this.targetId = ''
  }

  /** Called once after the script instance is attached and serialized props are merged. */
  onLoaded() {}

  /** Called each frame while the scene is active (`delta` in seconds). */
  onUpdate(_delta) {}

  /** Called when the script instance is torn down (scene change / unmount). */
  onDelete() {}
}
