// Global renderer reference for emergency cleanup during unhandled errors

interface RendererLike {
  destroy: () => void;
}

let globalRenderer: RendererLike | null = null;

export function setGlobalRenderer(renderer: RendererLike | null): void {
  globalRenderer = renderer;
}

export function getGlobalRenderer(): RendererLike | null {
  return globalRenderer;
}
