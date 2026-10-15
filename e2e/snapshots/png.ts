/**
 * Pure PNG analysis for the snapshot suite: decoding, the pixel diff, the diff
 * image, and the content-addressed pool. No Playwright, no fixed paths, so all
 * of it is testable on its own; the reporter layers the disk layout on top.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

export interface DecodedImage {
  width: number
  height: number
  channels: number
  pixels: Buffer
}

/** Decode an 8-bit RGB/RGBA PNG, the only kinds Playwright writes. */
export function decodePng(buffer: Buffer): DecodedImage {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data.readUInt8(9)
      if (data.readUInt8(8) !== 8 || ![2, 6].includes(colorType)) {
        throw new Error('unsupported PNG format')
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(height * stride)
  const previous = Buffer.alloc(stride)
  let input = 0
  for (let y = 0; y < height; y += 1) {
    const filter = inflated.readUInt8(input)
    input += 1
    const row = pixels.subarray(y * stride, y * stride + stride)
    inflated.copy(row, 0, input, input + stride)
    input += stride
    unfilter(row, previous, filter, channels)
    row.copy(previous)
  }
  return { width, height, channels, pixels }
}

/**
 * Per-channel difference below which two pixels count as identical. PNG
 * re-encoding and font rasterisation introduce a level or two of invisible
 * noise; a real change (a recoloured button, new text) is tens to hundreds of
 * levels, well clear of this floor.
 */
export const DIFF_CHANNEL_THRESHOLD = 4

/**
 * How much two frames may disagree, added up over every differing pixel's
 * channel deltas, and still count as the same picture. Pixel count alone
 * cannot tell antialiasing noise from a real change: both are "some pixels
 * differ". How much they differ separates them: glyph-edge noise totals in
 * the hundreds, a reflowed line or a changed word in the hundreds of thousands.
 */
export const NOISE_TOTAL_DELTA = 2_000

/**
 * Independent backstop on sheer area: this many differing pixels flags as
 * changed however small each difference is.
 */
export const WIDE_CHANGE_DIFF_PX = 1_000

const HEATMAP_RAMP = ' .:-=+*#%@'
export const HEATMAP_COLS = 80
export const HEATMAP_ROWS = 40

export interface DiffBbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Full diff analysis of two decoded images: pixel count, total channel delta,
 * bounding box of the changed region, a coarse grid of per-cell counts, and an
 * ASCII heatmap. Stored in each capture's sidecar so the gallery can say
 * where a change is without decoding the PNGs again.
 */
export interface DiffAnalysis {
  count: number
  totalDelta: number
  bbox: DiffBbox | null
  gridCols: number
  gridRows: number
  regionCounts: number[]
  heatmap: string
}

/** Whether an analysis crosses the noise floor and counts as a real change. */
export function isRealChange(diff: DiffAnalysis): boolean {
  return diff.totalDelta > NOISE_TOTAL_DELTA || diff.count > WIDE_CHANGE_DIFF_PX
}

function fullChangeAnalysis(width: number, height: number): DiffAnalysis {
  const fullBlock = HEATMAP_RAMP.charAt(HEATMAP_RAMP.length - 1)
  const row = fullBlock.repeat(HEATMAP_COLS)
  return {
    count: width * height,
    totalDelta: width * height * 255,
    bbox: width === 0 || height === 0 ? null : { x0: 0, y0: 0, x1: width - 1, y1: height - 1 },
    gridCols: HEATMAP_COLS,
    gridRows: HEATMAP_ROWS,
    regionCounts: Array.from({ length: HEATMAP_COLS * HEATMAP_ROWS }, () => 1),
    heatmap: Array.from({ length: HEATMAP_ROWS }, () => row).join('\n'),
  }
}

function channelDelta(a: DecodedImage, ai: number, b: DecodedImage, bi: number): number {
  return Math.max(
    Math.abs(a.pixels.readUInt8(ai) - b.pixels.readUInt8(bi)),
    Math.abs(a.pixels.readUInt8(ai + 1) - b.pixels.readUInt8(bi + 1)),
    Math.abs(a.pixels.readUInt8(ai + 2) - b.pixels.readUInt8(bi + 2)),
  )
}

/**
 * Diff two decoded images in one pass. A size mismatch is treated as fully
 * changed, with the count and bbox covering the current frame `b` so the diff
 * image and the analysis agree.
 */
export function analyzeImages(a: DecodedImage, b: DecodedImage): DiffAnalysis {
  if (a.width !== b.width || a.height !== b.height) {
    return fullChangeAnalysis(b.width, b.height)
  }
  const cellW = Math.max(1, Math.ceil(a.width / HEATMAP_COLS))
  const cellH = Math.max(1, Math.ceil(a.height / HEATMAP_ROWS))
  const cells = HEATMAP_COLS * HEATMAP_ROWS
  const regionCounts = new Array<number>(cells).fill(0)
  const regionTotals = new Array<number>(cells).fill(0)
  let count = 0
  let totalDelta = 0
  let bbox: DiffBbox | null = null
  const total = a.width * a.height
  for (let pixel = 0; pixel < total; pixel += 1) {
    const x = pixel % a.width
    const y = Math.floor(pixel / a.width)
    const delta = channelDelta(a, pixel * a.channels, b, pixel * b.channels)
    const col = Math.min(HEATMAP_COLS - 1, Math.floor(x / cellW))
    const row = Math.min(HEATMAP_ROWS - 1, Math.floor(y / cellH))
    const cell = row * HEATMAP_COLS + col
    regionTotals[cell] += 1
    if (delta > DIFF_CHANNEL_THRESHOLD) {
      count += 1
      totalDelta += delta
      regionCounts[cell] += 1
      if (bbox === null) {
        bbox = { x0: x, y0: y, x1: x, y1: y }
      } else {
        if (x < bbox.x0) bbox.x0 = x
        if (x > bbox.x1) bbox.x1 = x
        if (y < bbox.y0) bbox.y0 = y
        if (y > bbox.y1) bbox.y1 = y
      }
    }
  }
  const lines: string[] = []
  for (let row = 0; row < HEATMAP_ROWS; row += 1) {
    let line = ''
    for (let col = 0; col < HEATMAP_COLS; col += 1) {
      const idx = row * HEATMAP_COLS + col
      const cellTotal = regionTotals[idx]
      const frac = cellTotal === 0 ? 0 : regionCounts[idx] / cellTotal
      const rampIdx = Math.min(HEATMAP_RAMP.length - 1, Math.floor(frac * HEATMAP_RAMP.length))
      line += HEATMAP_RAMP.charAt(rampIdx)
    }
    lines.push(line)
  }
  return {
    count,
    totalDelta,
    bbox,
    gridCols: HEATMAP_COLS,
    gridRows: HEATMAP_ROWS,
    regionCounts,
    heatmap: lines.join('\n'),
  }
}

export function analyzeDiff(previous: Buffer, current: Buffer): DiffAnalysis {
  return analyzeImages(decodePng(previous), decodePng(current))
}

/**
 * Render a diff image: changed pixels bright red, unchanged pixels the current
 * frame dimmed to 30% so the layout stays readable around the change. A size
 * mismatch is solid red at the current frame's size.
 */
export function renderDiffImage(a: DecodedImage, b: DecodedImage): DecodedImage {
  const { width, height } = b
  const channels = 3
  const pixels = Buffer.alloc(width * height * channels)
  const sizeMatch = a.width === b.width && a.height === b.height
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const out = pixel * channels
    const bi = pixel * b.channels
    const changed = !sizeMatch || channelDelta(a, pixel * a.channels, b, bi) > DIFF_CHANNEL_THRESHOLD
    if (changed) {
      pixels.writeUInt8(255, out)
      pixels.writeUInt8(0, out + 1)
      pixels.writeUInt8(0, out + 2)
    } else {
      pixels.writeUInt8(Math.floor(b.pixels.readUInt8(bi) * 0.3), out)
      pixels.writeUInt8(Math.floor(b.pixels.readUInt8(bi + 1) * 0.3), out + 1)
      pixels.writeUInt8(Math.floor(b.pixels.readUInt8(bi + 2) * 0.3), out + 2)
    }
  }
  return { width, height, channels, pixels }
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(...buffers: Buffer[]): number {
  let crc = 0xffffffff
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i += 1) {
      crc = CRC_TABLE[(crc ^ buf.readUInt8(i)) & 0xff] ^ (crc >>> 8)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeBuf, data), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

/** Encode an 8-bit RGB or RGBA image as a PNG with no row filtering. */
export function encodePng(image: DecodedImage): Buffer {
  const { width, height, channels, pixels } = image
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(channels === 4 ? 6 : 2, 9)
  const stride = width * channels
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function unfilter(row: Buffer, previous: Buffer, filter: number, channels: number): void {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? row.readUInt8(index - channels) : 0
    const up = previous.readUInt8(index)
    const upLeft = index >= channels ? previous.readUInt8(index - channels) : 0
    if (filter === 1) {
      row.writeUInt8((row.readUInt8(index) + left) & 255, index)
    } else if (filter === 2) {
      row.writeUInt8((row.readUInt8(index) + up) & 255, index)
    } else if (filter === 3) {
      row.writeUInt8((row.readUInt8(index) + Math.floor((left + up) / 2)) & 255, index)
    } else if (filter === 4) {
      row.writeUInt8((row.readUInt8(index) + paeth(left, up, upLeft)) & 255, index)
    }
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}

/** SHA-256 of a PNG, the content-addressed key into the pool. */
export function pngSha(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Copy a PNG into the pool unless it is already there, and return its sha.
 * Identical captures across runs, lanes or tests share one file on disk.
 */
export async function ingestToPool(buffer: Buffer, poolDir: string): Promise<string> {
  const sha = pngSha(buffer)
  const poolPath = join(poolDir, `${sha}.png`)
  if (!existsSync(poolPath)) {
    await mkdir(poolDir, { recursive: true })
    await writeFile(poolPath, buffer)
  }
  return sha
}

export interface HistoryEntry {
  sha: string
  capturedAt: string
  ref?: string
}

/** Per-capture timeline of (sha, capturedAt, ref?) entries. */
export type HistoryFile = Record<string, HistoryEntry[]>

export interface BaselineFile {
  /** The git ref `--against` captured, such as `main` or a sha. */
  ref: string
  /** What that ref resolved to when it was captured. */
  sha: string
  pinnedAt: string
  /** File name to content sha of each baseline PNG. */
  pins: Record<string, string>
}

/**
 * Append a capture to the history, skipping when the last entry for this file
 * already has the same sha so a no-change run does not pad the list. One
 * process owns a history file, and writes it through a rename so a reader
 * never meets a half-written one.
 */
export async function appendHistory(
  file: string,
  sha: string,
  ref: string | undefined,
  historyPath: string,
): Promise<void> {
  let history: HistoryFile = {}
  if (existsSync(historyPath)) {
    const raw = (await readFile(historyPath, 'utf8')).trim()
    if (raw.length > 0) history = JSON.parse(raw) as HistoryFile
  }
  const entries = history[file] ?? []
  if (entries[entries.length - 1]?.sha === sha) return
  const entry: HistoryEntry = { sha, capturedAt: new Date().toISOString() }
  if (ref !== undefined) entry.ref = ref
  entries.push(entry)
  history[file] = entries
  await mkdir(dirname(historyPath), { recursive: true })
  await writeFile(`${historyPath}.tmp`, JSON.stringify(history, null, 2))
  await rename(`${historyPath}.tmp`, historyPath)
}

export async function readBaseline(baselinePath: string): Promise<BaselineFile | undefined> {
  if (!existsSync(baselinePath)) return undefined
  return JSON.parse(await readFile(baselinePath, 'utf8')) as BaselineFile
}

export async function writeBaseline(baseline: BaselineFile, baselinePath: string): Promise<void> {
  await mkdir(dirname(baselinePath), { recursive: true })
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2))
}

/** Remove the baseline pin if there is one; returns whether one was cleared. */
export async function clearBaseline(baselinePath: string): Promise<boolean> {
  if (!existsSync(baselinePath)) return false
  await rm(baselinePath)
  return true
}
