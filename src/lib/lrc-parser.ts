export interface LrcLine {
  time: number // seconds, -1 for metadata
  text: string
}

const TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const METADATA_RE = /^\[([a-zA-Z]{2}):(.*)\]$/

/**
 * Parse an LRC format string into an array of timed lines.
 *
 * Supports:
 *   [mm:ss.xx]text         — standard timestamp
 *   [mm:ss.xxx]text        — millisecond precision
 *   [mm:ss]text            — no fractional part
 *   [mm:ss.xx][mm:ss.xx]  — multiple timestamps on one line
 *   [ti:Title] etc.        — metadata (returned with time=-1)
 */
export function parseLrc(lrcText: string): LrcLine[] {
  if (!lrcText) return []

  const lines = lrcText.split(/\r?\n/)
  const result: LrcLine[] = []

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Check for metadata tag: [ti:...], [ar:...], etc.
    const metaMatch = METADATA_RE.exec(trimmed)
    if (metaMatch) {
      result.push({ time: -1, text: metaMatch[2].trim() })
      METADATA_RE.lastIndex = 0
      continue
    }
    METADATA_RE.lastIndex = 0

    // Extract all timestamps from the line
    const timestamps: number[] = []
    let match: RegExpExecArray | null
    let lastIndex = 0

    TIMESTAMP_RE.lastIndex = 0
    while ((match = TIMESTAMP_RE.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const frac = match[3] ? match[3].padEnd(3, '0') : '000'
      const ms = parseInt(frac, 10)
      timestamps.push(minutes * 60 + seconds + ms / 1000)
      lastIndex = TIMESTAMP_RE.lastIndex
    }
    TIMESTAMP_RE.lastIndex = 0

    if (timestamps.length > 0) {
      // Text is everything after the last timestamp tag
      const text = trimmed.slice(lastIndex).trim()
      for (const time of timestamps) {
        result.push({ time, text })
      }
    }
  }

  // Sort by time, metadata first (time === -1), then by time ascending
  result.sort((a, b) => {
    if (a.time === -1 && b.time === -1) return 0
    if (a.time === -1) return -1
    if (b.time === -1) return 1
    return a.time - b.time
  })

  return result
}

/**
 * Check whether a lyrics string appears to be in LRC format.
 * Looks for at least one [mm:ss] or [mm:ss.xx] timestamp pattern.
 */
export function isLrcFormat(text: string): boolean {
  if (!text) return false
  return /\[\d{1,3}:\d{2}([.:]\d{1,3})?\]/.test(text)
}

/**
 * Convert parsed LRC lines back into a valid LRC string.
 * Metadata lines (time === -1) are formatted as [key:value].
 */
export function toLrcString(lines: LrcLine[]): string {
  return lines
    .filter((line) => line.text !== '')
    .map((line) => {
      if (line.time === -1) {
        // Metadata line — try to infer the tag from text content
        return `[xx:${line.text}]`
      }
      const mins = Math.floor(line.time / 60)
      const secs = Math.floor(line.time % 60)
      const ms = Math.round((line.time % 1) * 100)
      return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}]${line.text}`
    })
    .join('\n')
}

/**
 * Find the index of the currently active lyric line for a given playback time.
 * Returns the index of the last line whose time <= currentTime.
 * Only considers lines with time >= 0 (not metadata).
 */
export function findActiveLine(lines: LrcLine[], currentTime: number): number {
  let activeIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time >= 0 && lines[i].time <= currentTime) {
      activeIndex = i
    } else if (lines[i].time >= 0 && lines[i].time > currentTime) {
      break
    }
  }
  return activeIndex
}
