import './glfx-latest-minified.js';

export function loadGlfx(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!(window as { fx?: unknown }).fx) {
    return Promise.reject(new Error('glfx failed to initialize'));
  }
  return Promise.resolve();
}
