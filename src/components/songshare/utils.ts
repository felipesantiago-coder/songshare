export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '--:--'
  return formatTime(seconds)
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}
