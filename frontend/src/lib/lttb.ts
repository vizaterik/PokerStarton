/** Largest-Triangle-Three-Buckets downsampling for large time series. */

export type LttbPoint = { x: number; y: number; i: number };

export function lttb<T>(
  data: T[],
  threshold: number,
  getX: (d: T, i: number) => number,
  getY: (d: T, i: number) => number,
): { point: T; index: number }[] {
  const n = data.length;
  if (threshold >= n || threshold < 3) {
    return data.map((point, index) => ({ point, index }));
  }

  const sampled: { point: T; index: number }[] = [];
  const bucketSize = (n - 2) / (threshold - 2);

  sampled.push({ point: data[0], index: 0 });

  let prevIndex = 0;
  for (let i = 0; i < threshold - 2; i += 1) {
    const rangeStart = Math.floor((i + 0) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);

    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1);

    let avgX = 0;
    let avgY = 0;
    const avgCount = Math.max(avgRangeEnd - avgRangeStart, 1);
    for (let j = avgRangeStart; j < avgRangeEnd; j += 1) {
      avgX += getX(data[j], j);
      avgY += getY(data[j], j);
    }
    avgX /= avgCount;
    avgY /= avgCount;

    const pointAx = getX(data[prevIndex], prevIndex);
    const pointAy = getY(data[prevIndex], prevIndex);

    let maxArea = -1;
    let maxIndex = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      const area =
        Math.abs(
          (pointAx - avgX) * (getY(data[j], j) - pointAy) -
            (pointAx - getX(data[j], j)) * (avgY - pointAy),
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampled.push({ point: data[maxIndex], index: maxIndex });
    prevIndex = maxIndex;
  }

  sampled.push({ point: data[n - 1], index: n - 1 });
  return sampled;
}
