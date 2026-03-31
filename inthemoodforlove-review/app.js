import {
  layoutNextLine,
  prepareWithSegments,
} from './vendor/pretext/layout.js'
import { carveTextLineSlots } from './shared-wrap.js'

const canvas = document.querySelector('#canvas')
const spacer = document.querySelector('#scroll-space')
const ctx = canvas.getContext('2d')

const ASSET_ROOT = './assets'
const FONT_STACK = 'SimSun, "Songti SC", "STSong", serif'
const TITLE_COLOR = '#f7f4ee'
const BODY_COLOR = '#e7e2d7'
const MASK_THRESHOLD = 18
const WOMAN_FACE_END = 0.7
const MAN_FACE_START = 0.02
const MAN_FACE_END = 0.58

const preparedCache = new Map()

const state = {
  ready: false,
  failed: false,
  dpr: Math.max(1, window.devicePixelRatio || 1),
  scrollY: window.scrollY || 0,
  raf: 0,
  needsLayout: true,
  needsRender: true,
  viewportWidth: 0,
  viewportHeight: 0,
  rawBlocks: [],
  blocks: [],
  stage: null,
  documentLayout: null,
  assets: {
    background: null,
    woman: null,
    man: null,
    smoke: null,
  },
  smoke: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    initialized: false,
    userMoved: false,
  },
  pointer: {
    id: null,
    down: false,
  },
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function smoothstep(t) {
  const clamped = clamp(t, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

function mergeIntervals(intervals, mergeGap = 0) {
  if (!intervals.length) return []
  const ordered = [...intervals].sort((a, b) => a.left - b.left)
  const merged = [ordered[0]]
  for (let index = 1; index < ordered.length; index++) {
    const current = ordered[index]
    const last = merged[merged.length - 1]
    if (current.left <= last.right + mergeGap) {
      last.right = Math.max(last.right, current.right)
      continue
    }
    merged.push({ ...current })
  }
  return merged
}

function requestFrame({ layout = false, render = true } = {}) {
  if (layout) state.needsLayout = true
  if (render) state.needsRender = true
  if (state.raf) return
  state.raf = window.requestAnimationFrame(frame)
}

function resizeCanvas(width, height) {
  state.viewportWidth = width
  state.viewportHeight = height
  state.dpr = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = Math.round(width * state.dpr)
  canvas.height = Math.round(height * state.dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
}

function drawMessage(text, color = BODY_COLOR) {
  const width = window.innerWidth || 1280
  const height = window.innerHeight || 720
  resizeCanvas(width, height)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#140806'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = color
  ctx.font = `28px ${FONT_STACK}`
  ctx.fillText(text, 48, Math.max(120, height * 0.2))
}

async function loadImage(src) {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  await image.decode()
  return image
}

function smoothContour(rowBounds, side, radius = 16) {
  const values = new Float32Array(rowBounds.length)

  for (let y = 0; y < rowBounds.length; y++) {
    let sum = 0
    let weightSum = 0
    for (let offset = -radius; offset <= radius; offset++) {
      const rowIndex = clamp(y + offset, 0, rowBounds.length - 1)
      const row = rowBounds[rowIndex]
      if (!row) continue
      const weight = radius + 1 - Math.abs(offset)
      sum += (side === 'left' ? row.left : row.right) * weight
      weightSum += weight
    }
    values[y] = weightSum ? sum / weightSum : Number.NaN
  }

  let nextValid = Number.NaN
  for (let index = values.length - 1; index >= 0; index--) {
    if (Number.isFinite(values[index])) {
      nextValid = values[index]
    } else if (Number.isFinite(nextValid)) {
      values[index] = nextValid
    }
  }

  let previous = 0
  for (let index = 0; index < values.length; index++) {
    if (Number.isFinite(values[index])) {
      previous = values[index]
    } else {
      values[index] = previous
    }
  }

  return values
}

function buildMaskGeometry(image, { maxHeight = image.naturalHeight, storeAlpha = false, includeRuns = false } = {}) {
  const scale = Math.min(1, maxHeight / image.naturalHeight)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const surface = document.createElement('canvas')
  surface.width = width
  surface.height = height
  const surfaceContext = surface.getContext('2d', { willReadFrequently: true })
  surfaceContext.clearRect(0, 0, width, height)
  surfaceContext.drawImage(image, 0, 0, width, height)
  const imageData = surfaceContext.getImageData(0, 0, width, height)
  const alpha = storeAlpha ? new Uint8Array(width * height) : null
  const rowBounds = new Array(height)
  const rowRuns = includeRuns ? new Array(height) : null

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    let left = -1
    let right = -1
    let currentRunStart = -1
    const runs = includeRuns ? [] : null

    for (let x = 0; x < width; x++) {
      const alphaValue = imageData.data[(rowOffset + x) * 4 + 3]
      if (alpha) alpha[rowOffset + x] = alphaValue

      const solid = alphaValue >= MASK_THRESHOLD
      if (solid) {
        if (left === -1) left = x
        right = x
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        if (includeRuns && currentRunStart === -1) currentRunStart = x
      } else if (includeRuns && currentRunStart !== -1) {
        if (x - currentRunStart >= 2) {
          runs.push({ left: currentRunStart / width, right: x / width })
        }
        currentRunStart = -1
      }
    }

    if (includeRuns && currentRunStart !== -1) {
      runs.push({ left: currentRunStart / width, right: 1 })
    }

    rowBounds[y] = left === -1 ? null : { left, right }
    if (includeRuns) rowRuns[y] = runs
  }

  return {
    image,
    width,
    height,
    alpha,
    rowBounds,
    rowRuns,
    bounds: {
      minX: maxX >= 0 ? minX : 0,
      minY: maxY >= 0 ? minY : 0,
      maxX: maxX >= 0 ? maxX : width - 1,
      maxY: maxY >= 0 ? maxY : height - 1,
    },
    leftContour: smoothContour(rowBounds, 'left'),
    rightContour: smoothContour(rowBounds, 'right'),
  }
}

function parseMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const blocks = []
  let paragraph = []

  function flushParagraph() {
    if (!paragraph.length) return
    blocks.push({ type: 'p', text: paragraph.join('').trim() })
    paragraph = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }
    if (line.startsWith('# ')) {
      flushParagraph()
      blocks.push({ type: 'h1', text: line.slice(2).trim() })
      continue
    }
    if (line.startsWith('## ')) {
      flushParagraph()
      blocks.push({ type: 'h2', text: line.slice(3).trim() })
      continue
    }
    paragraph.push(line)
  }

  flushParagraph()
  return blocks
}

function getPrepared(text, font) {
  const cacheKey = `${font}\n${text}`
  const cached = preparedCache.get(cacheKey)
  if (cached) return cached
  const prepared = prepareWithSegments(text, font)
  preparedCache.set(cacheKey, prepared)
  return prepared
}

function buildTypography(width) {
  const mobile = width < 760
  const compact = width < 1120
  const titleSize = mobile ? 32 : compact ? 38 : 42
  const h2Size = mobile ? 20 : compact ? 23 : 26
  const bodySize = mobile ? 17 : compact ? 19 : 22

  return {
    mobile,
    compact,
    titleSize,
    h2Size,
    bodySize,
    titleLineHeight: Math.round(titleSize * 1.18),
    h2LineHeight: Math.round(h2Size * 1.32),
    bodyLineHeight: Math.round(bodySize * 1.64),
    baselineRatio: mobile ? 0.84 : 0.82,
    titleFont: `700 ${titleSize}px ${FONT_STACK}`,
    h2Font: `700 ${h2Size}px ${FONT_STACK}`,
    bodyFont: `${bodySize}px ${FONT_STACK}`,
  }
}

function createReviewBlock(type, text, typography, overrides = {}) {
  if (type === 'h1') {
    return {
      type: 'h1',
      text,
      font: typography.titleFont,
      color: TITLE_COLOR,
      lineHeight: typography.titleLineHeight,
      blockGap: Math.round(typography.bodyLineHeight * 1.2),
      marginBefore: 0,
      minSlotWidth: typography.titleSize * 4.8,
      baselineOffset: Math.round(typography.titleLineHeight * typography.baselineRatio),
      slotMode: 'multi',
      prepared: getPrepared(text, typography.titleFont),
      ...overrides,
    }
  }

  if (type === 'h2') {
    return {
      type: 'h2',
      text,
      font: typography.h2Font,
      color: BODY_COLOR,
      lineHeight: typography.h2LineHeight,
      blockGap: Math.round(typography.bodyLineHeight * 0.42),
      marginBefore: Math.round(typography.bodyLineHeight * 0.7),
      minSlotWidth: typography.h2Size * 4.4,
      baselineOffset: Math.round(typography.h2LineHeight * typography.baselineRatio),
      slotMode: 'multi',
      prepared: getPrepared(text, typography.h2Font),
      ...overrides,
    }
  }

  return {
    type: 'p',
    text,
    font: typography.bodyFont,
    color: BODY_COLOR,
    lineHeight: typography.bodyLineHeight,
    blockGap: Math.round(typography.bodyLineHeight * 0.72),
    marginBefore: 0,
    minSlotWidth: typography.bodySize * 3.5,
    baselineOffset: Math.round(typography.bodyLineHeight * typography.baselineRatio),
    slotMode: 'multi',
    prepared: getPrepared(text, typography.bodyFont),
    ...overrides,
  }
}

function getMaxSlotWidth(slots, fallbackWidth) {
  if (!slots.length) return fallbackWidth
  let maxWidth = fallbackWidth
  for (const slot of slots) {
    maxWidth = Math.max(maxWidth, slot.right - slot.left)
  }
  return maxWidth
}

function splitTitleIfNeeded(text, typography, stage) {
  const normalizedText = text.replace(/[，,]+/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = text
    .split(/[，,]/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length < 2) return [normalizedText]

  const probeBlock = createReviewBlock('h1', normalizedText, typography)
  const probeSlots = getSlotsForBand(
    probeBlock,
    stage,
    stage.textTop,
    stage.textTop + typography.titleLineHeight,
  )

  ctx.save()
  ctx.font = typography.titleFont
  const fullWidth = ctx.measureText(normalizedText).width
  ctx.restore()

  const maxSlotWidth = getMaxSlotWidth(probeSlots, stage.stableRight - stage.stableLeft)
  if (fullWidth <= maxSlotWidth) return [normalizedText]

  return parts.map(part => part.replace(/\s+/g, ' ').trim())
}

function buildReviewBlocks(rawBlocks, typography, stage) {
  const blocks = []

  for (const block of rawBlocks) {
    if (block.type === 'h1') {
      const titleLines = splitTitleIfNeeded(block.text, typography, stage)
      titleLines.forEach((lineText, index) => {
        blocks.push(
          createReviewBlock('h1', lineText, typography, {
            blockGap:
              index === titleLines.length - 1 ? Math.round(typography.bodyLineHeight * 1.2) : 0,
          }),
        )
      })
      continue
    }

    blocks.push(createReviewBlock(block.type, block.text, typography))
  }

  return blocks
}

function contourXAtY(geometry, rect, side, y) {
  const localY = clamp((y - rect.y) / rect.height, 0, 1)
  const index = clamp(Math.round(localY * (geometry.height - 1)), 0, geometry.height - 1)
  const contour = side === 'left' ? geometry.leftContour : geometry.rightContour
  return rect.x + (contour[index] / geometry.width) * rect.width
}

function getPortraitRect(image, viewportWidth, viewportHeight, targetHeight, alignRight) {
  const scale = targetHeight / image.naturalHeight
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  return {
    x: alignRight ? viewportWidth - width : 0,
    y: viewportHeight - height,
    width,
    height,
  }
}

function getMobileWomanRect(image, viewportWidth, viewportHeight, visibleRatio = 1 / 3) {
  const rect = getPortraitRect(image, viewportWidth, viewportHeight, viewportHeight, false)
  rect.y = 0

  const targetVisibleWidth = clamp(
    Math.max(viewportWidth * visibleRatio, rect.width * (2 / 3)),
    0,
    viewportWidth,
  )
  if (rect.width > targetVisibleWidth) {
    rect.x = targetVisibleWidth - rect.width
  }

  return rect
}

function getRectProgress(rect, y) {
  return clamp((y - rect.y) / Math.max(1, rect.height), 0, 1)
}

function rangeWeight(value, start, end) {
  if (end <= start) return value >= end ? 1 : 0
  return smoothstep((value - start) / (end - start))
}

function bandWeight(value, start, peakStart, peakEnd, end) {
  const rise = rangeWeight(value, start, peakStart)
  const fall = 1 - rangeWeight(value, peakEnd, end)
  return clamp(Math.min(rise, fall), 0, 1)
}

function getPortraitExtraInset(rect, y, mobile) {
  const localY = getRectProgress(rect, y)
  const jawWeight = bandWeight(localY, 0.42, 0.52, 0.66, 0.78)
  const lowerWeight = rangeWeight(localY, 0.62, 0.9)
  return jawWeight * (mobile ? 6 : 12) + lowerWeight * (mobile ? 7 : 16)
}

function getSmokeDefault(stage, typography) {
  if (stage.mobile) {
    return clampSmokePosition(
      stage.width - stage.smokeWidth - 18,
      stage.height - stage.smokeHeight - 18,
      stage,
    )
  }

  const defaultX = (stage.stableLeft + stage.stableRight) / 2 - stage.smokeWidth / 2
  const defaultY = Math.max(
    stage.textTop + typography.titleLineHeight + typography.bodyLineHeight * 2,
    stage.height * 0.56,
  )
  return clampSmokePosition(defaultX, defaultY, stage)
}

function pickWidestSlot(slots) {
  if (!slots.length) return null
  let widest = slots[0]
  for (let index = 1; index < slots.length; index++) {
    const slot = slots[index]
    if (slot.right - slot.left > widest.right - widest.left) widest = slot
  }
  return widest
}

function getSmokeLayoutRect(stage) {
  if (!stage) return null
  return {
    x: state.smoke.x,
    y: state.smoke.y,
    width: state.smoke.width,
    height: state.smoke.height,
  }
}

function getSmokeScreenRect(stage) {
  return getSmokeLayoutRect(stage)
}

function clampSmokePosition(x, y, stage = state.stage) {
  if (!stage) return { x, y }

  const smokeWidth = stage.smokeWidth ?? state.smoke.width
  const smokeHeight = stage.smokeHeight ?? state.smoke.height
  const maxX = Math.max(12, stage.width - smokeWidth - 12)
  const maxY = Math.max(12, stage.height - smokeHeight - 12)
  return {
    x: clamp(x, 12, maxX),
    y: clamp(y, 12, maxY),
  }
}

function computeStage(typography) {
  const previousStage = state.stage
  const width = state.viewportWidth
  const height = state.viewportHeight
  const mobile = typography.mobile

  const womanRect = mobile
    ? getMobileWomanRect(state.assets.woman.image, width, height)
    : getPortraitRect(
        state.assets.woman.image,
        width,
        height,
        Math.round(height * (width < 1120 ? 0.92 : 1)),
        false,
      )

  const manRect = mobile
    ? null
    : getPortraitRect(
        state.assets.man.image,
        width,
        height,
        Math.round(height * (width < 1120 ? 0.9 : 0.98)),
        true,
      )

  const textPad = mobile ? 18 : 26
  const textTop = mobile
    ? Math.max(Math.round(height * 0.08), 64)
    : Math.max(Math.round(height * 0.11), 82)
  const rightMargin = mobile ? clamp(width * 0.07, 22, 42) : clamp(width * 0.08, 36, 84)
  const transition = mobile ? 132 : 188

  const womanExitY = womanRect.y + womanRect.height * WOMAN_FACE_END
  const womanExitX =
    contourXAtY(state.assets.woman, womanRect, 'right', womanExitY) +
    textPad +
    getPortraitExtraInset(womanRect, womanExitY, mobile)

  let stableLeft = 0
  let stableRight = 0
  let manExitY = 0
  let manExitX = 0

  if (mobile) {
    stableRight = width - rightMargin
    const minimumReadableWidth = Math.max(152, width * 0.42)
    stableLeft = clamp(
      Math.min(womanExitX + 12, stableRight - minimumReadableWidth),
      22,
      stableRight - 120,
    )
  } else {
    manExitY = manRect.y + manRect.height * MAN_FACE_END
    manExitX =
      contourXAtY(state.assets.man, manRect, 'left', manExitY) -
      textPad -
      getPortraitExtraInset(manRect, manExitY, mobile)
    stableLeft = clamp(
      Math.min(womanExitX - 40, womanRect.x + womanRect.width * 0.72),
      36,
      width * 0.48,
    )
    stableRight = clamp(
      Math.max(manExitX + 40, manRect.x + manRect.width * 0.28),
      width * 0.52,
      width - rightMargin,
    )

    if (stableRight - stableLeft < 480) {
      const desiredWidth = clamp(width * 0.38, 460, 640)
      const center = (stableLeft + stableRight) / 2
      stableLeft = clamp(center - desiredWidth / 2, 36, width - desiredWidth - rightMargin)
      stableRight = stableLeft + desiredWidth
    }
  }

  const smokeHeight = mobile ? clamp(height * 0.32, 190, 280) : clamp(height * 0.42, 280, 420)
  const smokeWidth =
    smokeHeight *
    (state.assets.smoke.image.naturalWidth / state.assets.smoke.image.naturalHeight)

  const stage = {
    width,
    height,
    mobile,
    typography,
    textTop,
    textPad,
    rightMargin,
    transition,
    stableLeft,
    stableRight,
    bottomPadding: Math.round(height * 0.56),
    flowBottom: height - clamp(height * 0.06, 42, 72),
    woman: {
      rect: womanRect,
      faceEndY: womanExitY,
      exitX: womanExitX,
    },
    man: manRect
      ? {
          rect: manRect,
          faceStartY: manRect.y + manRect.height * MAN_FACE_START,
          faceEndY: manExitY,
          exitX: manExitX,
        }
      : null,
    smokeWidth,
    smokeHeight,
  }

  if (!state.smoke.initialized || (previousStage && previousStage.mobile !== mobile)) {
    const smokeDefault = getSmokeDefault(stage, typography)
    state.smoke.x = smokeDefault.x
    state.smoke.y = smokeDefault.y
    state.smoke.width = smokeWidth
    state.smoke.height = smokeHeight
    state.smoke.initialized = true
  } else {
    const previousSmokeScreenRect = getSmokeScreenRect(previousStage)
    const previousSmokeCenterX =
      previousSmokeScreenRect?.x !== undefined
        ? previousSmokeScreenRect.x + previousSmokeScreenRect.width / 2
        : state.smoke.x + state.smoke.width / 2
    const previousSmokeCenterY =
      previousSmokeScreenRect?.y !== undefined
        ? previousSmokeScreenRect.y + previousSmokeScreenRect.height / 2
        : state.smoke.y + state.smoke.height / 2
    const previousStageWidth = Math.max(1, previousStage?.width ?? width)
    const previousStageHeight = Math.max(1, previousStage?.height ?? height)
    const centerRatioX = previousSmokeCenterX / previousStageWidth
    const preservedCenterY = clamp(
      previousSmokeCenterY,
      12 + smokeHeight / 2,
      previousStageHeight - smokeHeight / 2 - 12,
    )
    state.smoke.width = smokeWidth
    state.smoke.height = smokeHeight
    const next = clampSmokePosition(
      centerRatioX * width - smokeWidth / 2,
      preservedCenterY - smokeHeight / 2,
      stage,
    )
    state.smoke.x = next.x
    state.smoke.y = next.y
  }

  return stage
}

function getWomanBoundary(stage, y) {
  const extraInset = getPortraitExtraInset(stage.woman.rect, y, stage.mobile)
  const contourX =
    contourXAtY(state.assets.woman, stage.woman.rect, 'right', y) + stage.textPad + extraInset
  if (y <= stage.woman.faceEndY) return contourX
  if (y >= stage.woman.faceEndY + stage.transition) {
    const bodyWeight = rangeWeight(getRectProgress(stage.woman.rect, y), 0.62, 0.92)
    return Math.max(stage.stableLeft, lerp(stage.stableLeft, contourX, bodyWeight))
  }
  const t = smoothstep((y - stage.woman.faceEndY) / stage.transition)
  const baseBoundary = lerp(stage.woman.exitX, stage.stableLeft, t)
  const bodyWeight = rangeWeight(getRectProgress(stage.woman.rect, y), 0.56, 0.88)
  return Math.max(baseBoundary, lerp(baseBoundary, contourX, bodyWeight))
}

function getManBoundary(stage, y) {
  if (!stage.man) return stage.stableRight
  const sampleY = Math.max(y, stage.man.faceStartY)
  const extraInset = getPortraitExtraInset(stage.man.rect, sampleY, stage.mobile)
  const contourX =
    contourXAtY(state.assets.man, stage.man.rect, 'left', sampleY) - stage.textPad - extraInset
  if (y <= stage.man.faceEndY) return contourX
  if (y >= stage.man.faceEndY + stage.transition) {
    const bodyWeight = rangeWeight(getRectProgress(stage.man.rect, sampleY), 0.56, 0.9)
    return Math.min(stage.stableRight, lerp(stage.stableRight, contourX, bodyWeight))
  }
  const t = smoothstep((y - stage.man.faceEndY) / stage.transition)
  const baseBoundary = lerp(stage.man.exitX, stage.stableRight, t)
  const bodyWeight = rangeWeight(getRectProgress(stage.man.rect, sampleY), 0.5, 0.84)
  return Math.min(baseBoundary, lerp(baseBoundary, contourX, bodyWeight))
}

function getCorridor(stage, bandTop, bandBottom) {
  const middleY = (bandTop + bandBottom) / 2
  const left = getWomanBoundary(stage, middleY)
  const right = stage.mobile ? stage.stableRight : getManBoundary(stage, middleY)

  if (right - left >= 120) return { left, right }
  return { left: stage.stableLeft, right: stage.stableRight }
}

function getMaskRunsForBand(mask, rect, bandTop, bandBottom, hPad = 0, vPad = 0) {
  const sampleTop = bandTop - rect.y - vPad
  const sampleBottom = bandBottom - rect.y + vPad
  if (sampleBottom <= 0 || sampleTop >= rect.height) return []

  const start = clamp(Math.floor((sampleTop / rect.height) * mask.height), 0, mask.height - 1)
  const end = clamp(Math.ceil((sampleBottom / rect.height) * mask.height), 0, mask.height - 1)
  const intervals = []

  for (let row = start; row <= end; row++) {
    const runs = mask.rowRuns[row]
    if (!runs || !runs.length) continue
    for (const run of runs) {
      intervals.push({
        left: rect.x + run.left * rect.width - hPad,
        right: rect.x + run.right * rect.width + hPad,
      })
    }
  }

  return mergeIntervals(intervals, 4)
}

function getSmokeIntervals(stage, bandTop, bandBottom) {
  const intervals = getMaskRunsForBand(
    state.assets.smoke,
    getSmokeLayoutRect(stage),
    bandTop,
    bandBottom,
    8,
    6,
  )

  if (!intervals.length) return []
  return intervals
    .map(interval => ({
      left: clamp(interval.left, 12, stage.width - 12),
      right: clamp(interval.right, 12, stage.width - 12),
    }))
    .filter(interval => interval.right - interval.left > 4)
}

function getSlotsForBand(block, stage, bandTop, bandBottom) {
  const corridor = getCorridor(stage, bandTop, bandBottom)
  const smokeIntervals = getSmokeIntervals(stage, bandTop, bandBottom)
    .filter(interval => interval.right > corridor.left && interval.left < corridor.right)
    .map(interval => ({
      left: clamp(interval.left, corridor.left, corridor.right),
      right: clamp(interval.right, corridor.left, corridor.right),
    }))

  let slots = smokeIntervals.length
    ? carveTextLineSlots(corridor, smokeIntervals, block.minSlotWidth)
    : corridor.right - corridor.left >= block.minSlotWidth
      ? [corridor]
      : []

  return slots
}

function layoutBlocks(stage, blocks) {
  const lines = []
  let cursorY = stage.textTop

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]
    cursorY += block.marginBefore
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    let safety = 0

    while (safety < 10000) {
      safety += 1
      const bandTop = cursorY
      const bandBottom = bandTop + block.lineHeight
      const slots = getSlotsForBand(block, stage, bandTop, bandBottom)

      if (!slots.length) {
        cursorY += block.lineHeight
        continue
      }

      let usedBand = false
      let reachedBlockEnd = false

      for (const slot of slots) {
        const cursorStart = { ...cursor }
        const piece = layoutNextLine(block.prepared, cursor, slot.right - slot.left)
        if (piece === null) {
          reachedBlockEnd = true
          break
        }

        lines.push({
          text: piece.text,
          x: slot.left,
          y: bandTop + block.baselineOffset,
          top: bandTop,
          bottom: bandBottom,
          font: block.font,
          color: block.color,
          type: block.type,
          slotWidth: slot.right - slot.left,
          blockIndex,
          cursorStart,
          cursorEnd: { ...piece.end },
        })

        cursor = { ...piece.end }
        usedBand = true
      }

      if (usedBand) cursorY += block.lineHeight
      if (reachedBlockEnd) break
    }

    cursorY += block.blockGap
  }

  const totalHeight = Math.max(cursorY + stage.bottomPadding, stage.height + 2)
  return {
    lines,
    contentBottom: cursorY,
    totalHeight,
  }
}

function drawCoverImage(image, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  const x = (width - drawWidth) / 2
  const y = (height - drawHeight) / 2
  ctx.drawImage(image, x, y, drawWidth, drawHeight)
}

function drawBackground(stage) {
  ctx.clearRect(0, 0, stage.width, stage.height)
  drawCoverImage(state.assets.background.image, stage.width, stage.height)

  ctx.fillStyle = 'rgba(13, 6, 5, 0.18)'
  ctx.fillRect(0, 0, stage.width, stage.height)

  const amber = ctx.createRadialGradient(
    stage.width * 0.82,
    stage.height * 0.28,
    stage.width * 0.04,
    stage.width * 0.82,
    stage.height * 0.28,
    stage.width * 0.4,
  )
  amber.addColorStop(0, 'rgba(204, 126, 44, 0.18)')
  amber.addColorStop(0.48, 'rgba(204, 126, 44, 0.08)')
  amber.addColorStop(1, 'rgba(204, 126, 44, 0)')
  ctx.fillStyle = amber
  ctx.fillRect(0, 0, stage.width, stage.height)

  const vignette = ctx.createLinearGradient(0, 0, 0, stage.height)
  vignette.addColorStop(0, 'rgba(8, 3, 2, 0.38)')
  vignette.addColorStop(0.35, 'rgba(8, 3, 2, 0.08)')
  vignette.addColorStop(1, 'rgba(8, 3, 2, 0.48)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, stage.width, stage.height)
}

function drawPortraits(stage) {
  ctx.drawImage(
    state.assets.woman.image,
    stage.woman.rect.x,
    stage.woman.rect.y,
    stage.woman.rect.width,
    stage.woman.rect.height,
  )

  if (stage.man) {
    ctx.drawImage(
      state.assets.man.image,
      stage.man.rect.x,
      stage.man.rect.y,
      stage.man.rect.width,
      stage.man.rect.height,
    )
  }
}

function drawLineSet(lines, scrollOffset = 0) {
  let visibleCount = 0
  let widestVisibleSlot = 0

  for (const line of lines) {
    visibleCount += 1
    widestVisibleSlot = Math.max(widestVisibleSlot, line.slotWidth ?? 0)
    ctx.fillStyle = line.color
    ctx.font = line.font
    ctx.fillText(line.text, line.x, line.y - scrollOffset)
  }

  return { visibleCount, widestVisibleSlot }
}

function findAnchorLine(lines, scrollY) {
  if (!lines.length) return null
  let low = 0
  let high = lines.length - 1
  let match = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (lines[mid].top <= scrollY) {
      match = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  while (match > 0 && lines[match - 1].top === lines[match].top) {
    match -= 1
  }

  return lines[match]
}

function resolveViewportVisibleLayout(stage) {
  const anchor = findAnchorLine(state.documentLayout.lines, state.scrollY)
  if (!anchor) {
    return {
      lines: [],
      currentRibbonWidth: 0,
      visibleAdvanceStart: state.scrollY,
      visibleAdvanceEnd: state.scrollY + stage.height,
    }
  }

  const overscan = stage.mobile ? 150 : 180
  const visibleLines = []
  let widestVisibleSlot = 0
  let currentTop = anchor.top - state.scrollY
  let safety = 0

  for (let blockIndex = anchor.blockIndex; blockIndex < state.blocks.length; blockIndex++) {
    const block = state.blocks[blockIndex]
    let cursor =
      blockIndex === anchor.blockIndex
        ? { ...anchor.cursorStart }
        : { segmentIndex: 0, graphemeIndex: 0 }

    if (blockIndex !== anchor.blockIndex) {
      currentTop += block.marginBefore
    }

    while (safety < 10000) {
      safety += 1
      const bandTop = currentTop
      const bandBottom = bandTop + block.lineHeight

      if (bandTop > stage.flowBottom + overscan) {
        return {
          lines: visibleLines,
          currentRibbonWidth: widestVisibleSlot,
          visibleAdvanceStart: anchor.top,
          visibleAdvanceEnd: anchor.top + stage.height,
        }
      }

      const slots = getSlotsForBand(block, stage, bandTop, bandBottom)
      if (!slots.length) {
        currentTop += block.lineHeight
        continue
      }

      let usedBand = false
      let reachedBlockEnd = false

      for (const slot of slots) {
        const piece = layoutNextLine(block.prepared, cursor, slot.right - slot.left)
        if (piece === null) {
          reachedBlockEnd = true
          break
        }

        if (bandBottom >= -overscan && bandTop <= stage.flowBottom + overscan) {
          const line = {
            text: piece.text,
            x: slot.left,
            y: bandTop + block.baselineOffset,
            top: bandTop,
            bottom: bandBottom,
            font: block.font,
            color: block.color,
            type: block.type,
            slotWidth: slot.right - slot.left,
          }
          widestVisibleSlot = Math.max(widestVisibleSlot, line.slotWidth)
          visibleLines.push(line)
        }

        cursor = { ...piece.end }
        usedBand = true
      }

      if (usedBand) currentTop += block.lineHeight
      if (reachedBlockEnd) break
    }

    currentTop += block.blockGap
  }

  return {
    lines: visibleLines,
    currentRibbonWidth: widestVisibleSlot,
    visibleAdvanceStart: anchor.top,
    visibleAdvanceEnd: anchor.top + stage.height,
  }
}

function drawViewportText(stage) {
  const visibleLayout = resolveViewportVisibleLayout(stage)
  const drawn = drawLineSet(visibleLayout.lines)
  return {
    visibleLineCount: drawn.visibleCount,
    currentRibbonWidth: visibleLayout.currentRibbonWidth,
    visibleAdvanceStart: visibleLayout.visibleAdvanceStart,
    visibleAdvanceEnd: visibleLayout.visibleAdvanceEnd,
  }
}

function drawText(stage) {
  ctx.textBaseline = 'alphabetic'
  ctx.shadowColor = 'rgba(10, 4, 3, 0.32)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  const stats = drawViewportText(stage)

  ctx.shadowBlur = 0
  return stats
}

function drawSmoke(stage) {
  const smokeRect = getSmokeScreenRect(stage)
  if (!smokeRect) return null
  if (smokeRect.y > stage.height || smokeRect.y + smokeRect.height < -80) return null

  ctx.save()
  ctx.globalAlpha = state.smoke.dragging ? 0.96 : 0.92
  ctx.drawImage(
    state.assets.smoke.image,
    smokeRect.x,
    smokeRect.y,
    smokeRect.width,
    smokeRect.height,
  )
  ctx.restore()

  return smokeRect
}

function render() {
  if (!state.stage || !state.documentLayout) return
  state.needsRender = false

  drawBackground(state.stage)
  drawPortraits(state.stage)
  const textStats = drawText(state.stage)
  const smokeRect = drawSmoke(state.stage)

  window.__reviewState = {
    ready: state.ready,
    failed: state.failed,
    mode: state.stage.mobile ? 'mobile' : 'desktop',
    layoutMode: state.stage.mobile ? 'mobile-viewport' : 'desktop-viewport',
    blockCount: state.blocks.length,
    h2Count: state.rawBlocks.filter(block => block.type === 'h2').length,
    lineCount: state.documentLayout.lines.length,
    visibleLineCount: textStats.visibleLineCount,
    totalHeight: Math.round(state.documentLayout.totalHeight),
    currentRibbonWidth: Math.round(textStats.currentRibbonWidth),
    visibleAdvanceStart: Math.round(textStats.visibleAdvanceStart),
    visibleAdvanceEnd: Math.round(textStats.visibleAdvanceEnd),
    scrollY: Math.round(state.scrollY),
    smoke: {
      x: Math.round(state.smoke.x),
      y: Math.round(state.smoke.y),
      width: Math.round(state.smoke.width),
      height: Math.round(state.smoke.height),
      dragging: state.smoke.dragging,
      userMoved: state.smoke.userMoved,
      screenRect: smokeRect,
    },
    portraits: {
      woman: {
        x: Math.round(state.stage.woman.rect.x),
        y: Math.round(state.stage.woman.rect.y),
        width: Math.round(state.stage.woman.rect.width),
        height: Math.round(state.stage.woman.rect.height),
      },
      man: state.stage.man
        ? {
            x: Math.round(state.stage.man.rect.x),
            y: Math.round(state.stage.man.rect.y),
            width: Math.round(state.stage.man.rect.width),
            height: Math.round(state.stage.man.rect.height),
          }
        : null,
    },
    stableCorridor: {
      left: Math.round(state.stage.stableLeft),
      right: Math.round(state.stage.stableRight),
    },
    typography: {
      titleFont: state.stage.typography.titleFont,
      bodyFont: state.stage.typography.bodyFont,
    },
  }
}

function performLayout() {
  if (!state.ready) return
  resizeCanvas(window.innerWidth, window.innerHeight)
  const typography = buildTypography(state.viewportWidth)
  state.stage = computeStage(typography)
  state.blocks = buildReviewBlocks(state.rawBlocks, typography, state.stage)
  state.documentLayout = layoutBlocks(state.stage, state.blocks)
  const clamped = clampSmokePosition(
    state.smoke.x,
    state.smoke.y,
    state.stage,
  )
  if (clamped.x !== state.smoke.x || clamped.y !== state.smoke.y) {
    state.smoke.x = clamped.x
    state.smoke.y = clamped.y
    state.documentLayout = layoutBlocks(state.stage, state.blocks)
  }
  spacer.style.height = `${Math.ceil(state.documentLayout.totalHeight)}px`
  state.needsLayout = false
  state.needsRender = true
}

function frame() {
  state.raf = 0
  if (state.failed) return
  if (!state.ready) {
    if (state.needsRender) {
      state.needsRender = false
      drawMessage('Preparing review page...')
    }
    return
  }
  if (state.needsLayout) performLayout()
  if (state.needsRender) render()
}

function pointOnCanvas(event) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  }
}

function pointInDocument(event) {
  const point = pointOnCanvas(event)
  return {
    x: point.x,
    y: point.y + state.scrollY,
  }
}

function pointForStage(event) {
  return pointOnCanvas(event)
}

function alphaAtPoint(mask, rect, pointX, pointY) {
  if (
    pointX < rect.x ||
    pointX > rect.x + rect.width ||
    pointY < rect.y ||
    pointY > rect.y + rect.height
  ) {
    return 0
  }

  const localX = clamp((pointX - rect.x) / rect.width, 0, 0.999999)
  const localY = clamp((pointY - rect.y) / rect.height, 0, 0.999999)
  const x = clamp(Math.floor(localX * mask.width), 0, mask.width - 1)
  const y = clamp(Math.floor(localY * mask.height), 0, mask.height - 1)
  return mask.alpha[y * mask.width + x]
}

function isSmokeHit(pointX, pointY) {
  return (
    alphaAtPoint(state.assets.smoke, getSmokeLayoutRect(state.stage), pointX, pointY) >=
    MASK_THRESHOLD
  )
}

function beginSmokeDrag(event) {
  const point = pointForStage(event)
  if (!isSmokeHit(point.x, point.y)) return false

  state.pointer.id = event.pointerId
  state.pointer.down = true
  state.smoke.dragging = true
  state.smoke.dragOffsetX = point.x - state.smoke.x
  state.smoke.dragOffsetY = point.y - state.smoke.y
  canvas.setPointerCapture(event.pointerId)
  document.body.style.cursor = 'grabbing'
  return true
}

function updateSmokePosition(event) {
  if (!state.smoke.dragging || event.pointerId !== state.pointer.id) return
  const point = pointForStage(event)
  const next = clampSmokePosition(
    point.x - state.smoke.dragOffsetX,
    point.y - state.smoke.dragOffsetY,
    state.stage,
  )
  state.smoke.x = next.x
  state.smoke.y = next.y
  state.smoke.userMoved = true
  requestFrame({ layout: true, render: true })
}

function endSmokeDrag(event) {
  if (!state.smoke.dragging || event.pointerId !== state.pointer.id) return
  state.pointer.down = false
  state.smoke.dragging = false
  canvas.releasePointerCapture(event.pointerId)
  state.pointer.id = null
  document.body.style.cursor = ''
  requestFrame({ layout: true, render: true })
}

canvas.addEventListener('pointerdown', event => {
  if (beginSmokeDrag(event)) {
    event.preventDefault()
  }
})

canvas.addEventListener('pointermove', event => {
  if (!state.smoke.dragging) return
  updateSmokePosition(event)
  event.preventDefault()
})

canvas.addEventListener('pointerup', endSmokeDrag)
canvas.addEventListener('pointercancel', endSmokeDrag)

window.addEventListener(
  'scroll',
  () => {
    state.scrollY = window.scrollY || 0
    requestFrame({ render: true })
  },
  { passive: true },
)

window.addEventListener('resize', () => {
  requestFrame({ layout: true, render: true })
})

async function init() {
  drawMessage('正在准备花样年华影评页…')

  const [markdown, background, woman, man, smoke] = await Promise.all([
    fetch(`${ASSET_ROOT}/movieReview.md`).then(async response => {
      if (!response.ok) throw new Error('Failed to load markdown')
      return response.text()
    }),
    loadImage(`${ASSET_ROOT}/background.png`),
    loadImage(`${ASSET_ROOT}/woman.png`),
    loadImage(`${ASSET_ROOT}/man.png`),
    loadImage(`${ASSET_ROOT}/smoke.png`),
  ])

  if (document.fonts?.ready) {
    await document.fonts.ready
  }

  state.rawBlocks = parseMarkdown(markdown)
  state.assets.background = { image: background }
  state.assets.woman = buildMaskGeometry(woman, { maxHeight: 1440 })
  state.assets.man = buildMaskGeometry(man, { maxHeight: 1440 })
  state.assets.smoke = buildMaskGeometry(smoke, {
    maxHeight: 1400,
    includeRuns: true,
    storeAlpha: true,
  })

  state.ready = true
  state.scrollY = window.scrollY || 0
  requestFrame({ layout: true, render: true })
}

init().catch(error => {
  state.failed = true
  console.error(error)
  drawMessage('影评页加载失败，请检查本地资源。', '#f3b6a2')
})
