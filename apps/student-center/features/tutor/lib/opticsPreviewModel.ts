/** Illustrative calculations only: not measurements, observations, or mastery evidence. */
export function diffractionPreview(wavelengthNm: number, slitWidthUm: number, screenDistanceM: number) {
  if (!Number.isFinite(wavelengthNm) || wavelengthNm < 400 || wavelengthNm > 750
    || !Number.isFinite(slitWidthUm) || slitWidthUm < 10 || slitWidthUm > 200
    || !Number.isFinite(screenDistanceM) || screenDistanceM < 0.5 || screenDistanceM > 2) {
    throw new RangeError('Outside the preview model range');
  }
  const firstMinAngleRad = Math.asin(wavelengthNm / (slitWidthUm * 1000));
  return {
    firstMinAngleMrad: firstMinAngleRad * 1000,
    centralBandWidthMm: 2 * screenDistanceM * Math.tan(firstMinAngleRad) * 1000,
  };
}

export function scatteringPreview(wavelengthNm: number, particleRadiusNm: number) {
  if (!Number.isFinite(wavelengthNm) || wavelengthNm < 400 || wavelengthNm > 750
    || !Number.isFinite(particleRadiusNm) || particleRadiusNm < 5 || particleRadiusNm > 300) {
    throw new RangeError('Outside the preview model range');
  }
  const sizeParameter = 2 * Math.PI * particleRadiusNm / wavelengthNm;
  const isRayleigh = sizeParameter < 0.1;
  return { sizeParameter, isRayleigh, rayleighRatio: isRayleigh ? (700 / wavelengthNm) ** 4 : null };
}
