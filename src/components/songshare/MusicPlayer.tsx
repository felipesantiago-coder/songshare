'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import { formatTime } from './utils'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useSongShareStore } from '@/store/songshare'

interface MusicPlayerProps {
  audioRef: React.RefObject<HTMLAudioElement | null>
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrevious: () => void
}

export function MusicPlayer({
  audioRef,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrevious,
}: MusicPlayerProps) {
  const { room, socket, audioCache } = useSongShareStore()
  const [isMuted, setIsMuted] = React.useState(false)
  const [volume, setVolume] = React.useState(1)
  const [localTime, setLocalTime] = React.useState(0)

  const isHost = room?.hostId === socket?.id
  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  const audioUrl = currentTrack ? audioCache.get(currentTrack.id) : null

  // Update local time from audio element
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      setLocalTime(audio.currentTime)
    }

    const handleEnded = () => {
      if (isHost) {
        onNext()
      }
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [audioRef, isHost, onNext])

  // Sync when host changes track
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return

    const url = audioCache.get(currentTrack.id)
    if (url && audio.src !== url) {
      audio.src = url
      if (room?.isPlaying) {
        audio.currentTime = room.currentTime || 0
        audio.play().catch(() => {})
      }
    }
  }, [currentTrack?.id, audioCache, room?.isPlaying])

  const handleSeek = useCallback((value: number[]) => {
    const time = value[0]
    setLocalTime(time)
    onSeek(time)
  }, [onSeek])

  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [audioRef, isMuted])

  const handleVolumeChange = useCallback((value: number[]) => {
    const vol = value[0]
    setVolume(vol)
    if (audioRef.current) {
      audioRef.current.volume = vol
    }
  }, [audioRef])

  const progress = currentTrack ? (localTime / currentTrack.duration) * 100 : 0

  return (
    <div className="w-full">
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" />

      {/* Now playing info */}
      <div className="flex items-center gap-3 mb-3 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
          <div className={`w-3 h-3 rounded-full ${currentTrack ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">
            {currentTrack?.name || 'Nenhuma musica selecionada'}
          </p>
          <p className="text-xs text-zinc-500 truncate">
            {currentTrack?.artist || 'Adicione musicas para comecar'}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1 mb-3">
        <Slider
          value={[localTime]}
          max={currentTrack?.duration || 100}
          step={0.1}
          onValueChange={isHost ? handleSeek : undefined}
          disabled={!isHost || !currentTrack}
          className="w-full [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:bg-white [&_[role=slider]]:border-0 [&_[data-orientation=horizontal]>.bg-primary]:bg-rose-500"
        />
        <div className="flex justify-between text-xs text-zinc-500">
          <span>{formatTime(localTime)}</span>
          <span>{currentTrack ? formatTime(currentTrack.duration) : '0:00'}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrevious}
          disabled={!isHost || !currentTrack}
          className="text-zinc-400 hover:text-white h-9 w-9 rounded-full"
        >
          <SkipBack className="w-4 h-4" />
        </Button>

        <Button
          size="icon"
          onClick={room?.isPlaying ? onPause : onPlay}
          disabled={!isHost || !currentTrack}
          className="h-12 w-12 rounded-full bg-white text-zinc-900 hover:bg-zinc-200 shadow-lg transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {room?.isPlaying ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!isHost || !currentTrack}
          className="text-zinc-400 hover:text-white h-9 w-9 rounded-full"
        >
          <SkipForward className="w-4 h-4" />
        </Button>

        {/* Volume */}
        <div className="flex items-center gap-1 ml-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className="text-zinc-400 hover:text-white h-8 w-8 rounded-full"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <div className="w-20 hidden sm:block">
            <Slider
              value={[isMuted ? 0 : volume]}
              max={1}
              step={0.01}
              onValueChange={handleVolumeChange}
              className="[&_[role=slider]]:h-2.5 [&_[role=slider]]:w-2.5 [&_[role=slider]]:bg-white [&_[role=slider]]:border-0 [&_[data-orientation=horizontal]>.bg-primary]:bg-rose-500"
            />
          </div>
        </div>
      </div>

      {!isHost && currentTrack && (
        <p className="text-xs text-zinc-600 text-center mt-2">
          Apenas o host pode controlar a reproducao
        </p>
      )}
    </div>
  )
}
