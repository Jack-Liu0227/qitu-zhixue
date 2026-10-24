/** Keep drawing coordinates in CSS pixels while matching the display's backing resolution. */
export function prepareOpticsCanvas(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
  return { context, width, height, pixelWidth, pixelHeight };
}
