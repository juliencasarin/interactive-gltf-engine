/**
 * interactive-gltf interaction bases (author-facing ES module).
 * Served at /igltf-core/interaction-bases.js — extend in project scripts:
 *   import { EventInteraction } from '/igltf-core/interaction-bases.js'
 * Runtime injects global GLTF before your module loads.
 * Canonical source: igltf-engine/js/interaction-bases.js
 */

import { GlTFScript } from './gltf-script.js'

export { GlTFScript } from './gltf-script.js'

export class Interaction extends GlTFScript {
  handleInteraction(_payload) {
    return undefined
  }
}

export class EventInteraction extends Interaction {
  onEvent(_payload) {
    return undefined
  }
}

export class LinkInteraction extends Interaction {
  constructor() {
    super()
    this.href = ''
  }

  onLink(_payload) {
    return undefined
  }
}

export class FormInteraction extends Interaction {
  constructor() {
    super()
    this.formId = ''
  }

  onForm(_payload) {
    return undefined
  }
}

export class ManipulationInteraction extends Interaction {
  onManipulation(_payload) {
    return undefined
  }
}

export class ParameterInteraction extends Interaction {
  onParameter(_payload) {
    return undefined
  }
}

/** Reserved — not implemented in Play runtime at this stage. */
export class DrawingInteraction extends Interaction {
  constructor() {
    super()
    this.strokeId = ''
  }

  onDrawing(_payload) {
    return undefined
  }
}
