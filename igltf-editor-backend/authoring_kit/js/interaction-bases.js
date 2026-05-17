/**
 * interactive-gltf interaction bases (author-facing ES module).
 * Served at /igltf-core/interaction-bases.js — extend in project scripts:
 *   import { EventInteraction } from '/igltf-core/interaction-bases.js'
 * Runtime injects global GLTF before your module loads.
 */

export class EventInteraction {
  constructor() {
    this.targetId = ''
  }

  onLoaded() {}

  onEvent(_payload) {
    return undefined
  }
}

export class LinkInteraction {
  constructor() {
    this.targetId = ''
    this.href = ''
  }

  onLoaded() {}

  onLink(_payload) {
    return undefined
  }
}

export class FormInteraction {
  constructor() {
    this.targetId = ''
    this.formId = ''
  }

  onLoaded() {}

  onForm(_payload) {
    return undefined
  }
}

export class ManipulationInteraction {
  constructor() {
    this.targetId = ''
  }

  onLoaded() {}

  onManipulation(_payload) {
    return undefined
  }
}

export class DrawingInteraction {
  constructor() {
    this.targetId = ''
    this.strokeId = ''
  }

  onLoaded() {}

  onDrawing(_payload) {
    return undefined
  }
}
