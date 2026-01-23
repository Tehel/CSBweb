export {};

declare global {
  interface GLFXTexture {
    loadContentsOf(source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): void;
  }

  interface GLFXCanvas extends HTMLCanvasElement {
    texture(source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement): GLFXTexture;
    draw(texture: GLFXTexture): GLFXCanvas;
    bulgePinch(x: number, y: number, radius: number, strength: number): GLFXCanvas;
    vignette(size: number, amount: number): GLFXCanvas;
    update(): void;
  }

  const fx: {
    canvas(): GLFXCanvas;
  };
}
