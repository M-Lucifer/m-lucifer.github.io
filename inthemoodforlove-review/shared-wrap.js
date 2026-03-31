export function carveTextLineSlots(base, blocked, minWidth = 40) {
  const ordered = [...blocked].sort((a, b) => a.left - b.left)
  let slots = [base]

  for (const interval of ordered) {
    const next = []
    for (const slot of slots) {
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }

  return slots.filter(slot => slot.right - slot.left >= minWidth)
}

export function circleIntervalForBand(cx, cy, r, bandTop, bandBottom, hPad = 0, vPad = 0) {
  const sampleTop = bandTop - vPad
  const sampleBottom = bandBottom + vPad
  if (sampleTop >= cy + r || sampleBottom <= cy - r) return null

  const dy =
    cy >= sampleTop && cy <= sampleBottom
      ? 0
      : cy < sampleTop
        ? sampleTop - cy
        : cy - sampleBottom

  if (dy >= r) return null
  const dx = Math.sqrt(r * r - dy * dy)
  return { left: cx - dx - hPad, right: cx + dx + hPad }
}

export function transformPoints(points, rect, angle = 0) {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  return points.map(point => {
    const localX = (point.x - 0.5) * rect.width
    const localY = (point.y - 0.5) * rect.height
    return {
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    }
  })
}

export function pointInPolygon(points, x, y) {
  let inside = false
  for (let index = 0, prev = points.length - 1; index < points.length; prev = index++) {
    const a = points[index]
    const b = points[prev]
    const intersects =
      (a.y > y) !== (b.y > y) &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

function getPolygonXsAtY(points, y) {
  const xs = []
  for (let index = 0, prev = points.length - 1; index < points.length; prev = index++) {
    const a = points[prev]
    const b = points[index]
    if (a.y === b.y) continue
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    if (y < minY || y >= maxY) continue
    const t = (y - a.y) / (b.y - a.y)
    xs.push(a.x + (b.x - a.x) * t)
  }
  xs.sort((a, b) => a - b)
  return xs
}

export function polygonIntervalForBand(points, bandTop, bandBottom, hPad = 0, vPad = 0) {
  const sampleTop = bandTop - vPad
  const sampleBottom = bandBottom + vPad
  const startY = Math.floor(sampleTop)
  const endY = Math.ceil(sampleBottom)

  let left = Infinity
  let right = -Infinity

  for (let y = startY; y <= endY; y++) {
    const xs = getPolygonXsAtY(points, y + 0.5)
    for (let index = 0; index + 1 < xs.length; index += 2) {
      const runLeft = xs[index]
      const runRight = xs[index + 1]
      if (runLeft < left) left = runLeft
      if (runRight > right) right = runRight
    }
  }

  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  return { left: left - hPad, right: right + hPad }
}
