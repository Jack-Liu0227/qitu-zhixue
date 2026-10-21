export interface RadarPoint { x: number; y: number }
export interface RadarMeasurement { value: number; minimum: number; maximum: number }

export function radarPoint(index: number, radius: number): RadarPoint {
  const angle = (index * 60 - 90) * Math.PI / 180;
  return { x: 300 + Math.cos(angle) * radius, y: 250 + Math.sin(angle) * radius };
}

export function radarPolygon(points: readonly RadarPoint[]): string {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

/** Geometry consumes confirmed scale values; missing observations never become zero. */
export function buildRadarGeometry(measurements: readonly (RadarMeasurement | null)[], radius = 156) {
  const points = Array.from({ length: 6 }, (_, index) => {
    const measurement = measurements[index];
    if (!measurement || !Number.isFinite(measurement.value) || !Number.isFinite(measurement.minimum)
      || !Number.isFinite(measurement.maximum) || measurement.maximum <= measurement.minimum
      || measurement.value < measurement.minimum || measurement.value > measurement.maximum) return null;
    return radarPoint(index, radius * (measurement.value - measurement.minimum) / (measurement.maximum - measurement.minimum));
  });
  const confirmed = points.filter((point): point is RadarPoint => point !== null);
  const segments: Array<{ from: RadarPoint; to: RadarPoint }> = [];
  if (confirmed.length < 6) for (let index = 0; index < 6; index++) {
    const from = points[index];
    const to = points[(index + 1) % 6];
    if (from && to) segments.push({ from, to });
  }
  return { points, segments, confirmedCount: confirmed.length,
    polygon: confirmed.length === 6 ? radarPolygon(confirmed) : null };
}
