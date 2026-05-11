'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { formatTime } from './utils'
import { Play, Pause, SkipBack, SkipForward, Volume2, Volume1, VolumeX, FileText, Youtube, Music, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { useSongShareStore } from '@/store/songshare'
import { isLrcFormat } from '@/lib/lrc-parser'
import { searchYouTube as searchYouTubeApi, type YouTubeVideo } from '@/lib/youtube-search'

interface YouTubeTrack {
  id: string
  title: string
  artist: string
  duration: number
  thumbnail: string
}

interface MusicPlayerProps {
  audioRef: RefObject<HTMLAudioElement | null>
  onPlay: () => void
  onPause: () => void
  onSeek: (time: number) => void
  onNext: () => void
  onPrevious: () => void
}

// Declare YouTube IFrame API types
declare global {
  interface Window {
    YT?: {
      Player: new (elementId: string, config: YT.PlayerOptions) => YT.Player
      LoadingState: {
        UNSTARTED: number
        ENDED: number
        PLAYING: number
        PAUSED: number
        BUFFERING: number
        CUED: number
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

namespace YT {
  export interface PlayerOptions {
    videoId?: string
    width?: number | string
    height?: number | string
    playerVars?: {
      autoplay?: number
      controls?: number
      disablekb?: number
      fs?: number
      modestbranding?: number
      rel?: number
    }
    events?: {
      onReady?: (event: { target: Player }) => void
      onStateChange?: (event: { target: Player; data: number }) => void
      onError?: (event: { target: Player; data: number }) => void
    }
  }

  export interface Player {
    playVideo: () => void
    pauseVideo: () => void
    seekTo: (seconds: number, allowSeekAhead: boolean) => void
    getCurrentTime: () => number
    getDuration: () => number
    getPlayerState: () => number
    destroy: () => void
    loadVideoById: (videoId: string, startSeconds?: number) => void
    cueVideoById: (videoId: string, startSeconds?: number) => void
  }
}

export function MusicPlayer({
  audioRef,
  onPlay,
  onPause,
  onSeek,
  onNext,
  onPrevious,
}: MusicPlayerProps) {
  const room = useSongShareStore((state) => state.room)
  const socket = useSongShareStore((state) => state.socket)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [smoothTime, setSmoothTime] = useState(0)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const rafRef = useRef<number>(0)
  
  // YouTube states
  const [isYouTubeMode, setIsYouTubeMode] = useState(false)
  const [youTubePlayer, setYouTubePlayer] = useState<YT.Player | null>(null)
  const [youtubeId, setYoutubeId] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<YouTubeTrack[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [isYouTubeReady, setIsYouTubeReady] = useState(false)
  const playerContainerRef = useRef<HTMLDivElement>(null)

  const isHost = room?.hostId === socket?.id
  const currentTrack = room && room.currentTrackIndex >= 0
    ? room.playlist[room.currentTrackIndex]
    : null

  // Detect YouTube mode from track metadata
  useEffect(() => {
    if (currentTrack?.url?.includes('youtube.com') || currentTrack?.url?.includes('youtu.be')) {
      const videoId = currentTrack.url.split(/(?:\/|v=|\.be\/)([^&?#]+)/)[1]
      if (videoId) {
        setIsYouTubeMode(true)
        setYoutubeId(videoId)
      }
    } else {
      setIsYouTubeMode(false)
      setYoutubeId(null)
    }
  }, [currentTrack])

  // Load YouTube IFrame API
  useEffect(() => {
    if (!isYouTubeMode || !youtubeId) return

    const loadYouTubeAPI = () => {
      if (window.YT && window.YT.Player) {
        initYouTubePlayer()
      } else {
        const tag = document.createElement('script')
        tag.src = 'https://www.youtube.com/iframe_api'
        const firstScriptTag = document.getElementsByTagName('script')[0]
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)
        
        window.onYouTubeIframeAPIReady = () => {
          initYouTubePlayer()
        }
      }
    }

    const initYouTubePlayer = () => {
      if (!playerContainerRef.current || !youtubeId) return
      
      const player = new window.YT!.Player(playerContainerRef.current, {
        videoId: youtubeId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            setIsYouTubeReady(true)
            setYouTubePlayer(event.target)
          },
          onStateChange: (event) => {
            const state = event.data
            const YT = window.YT!.LoadingState
            if (state === YT.PLAYING) {
              setIsAudioPlaying(true)
            } else if (state === YT.PAUSED || state === YT.ENDED) {
              setIsAudioPlaying(false)
            }
          },
        },
      })
    }

    loadYouTubeAPI()

    return () => {
      if (youTubePlayer) {
        youTubePlayer.destroy()
        setYouTubePlayer(null)
      }
    }
  }, [isYouTubeMode, youtubeId])

  // Sync YouTube player with room state
  useEffect(() => {
    if (!isYouTubeMode || !youTubePlayer || !isYouTubeReady) return

    if (isHost) {
      // Host controls the player
      if (room?.isPlaying && isAudioPlaying === false) {
        youTubePlayer.playVideo()
      } else if (!room?.isPlaying && isAudioPlaying) {
        youTubePlayer.pauseVideo()
      }
    }
  }, [isYouTubeMode, youTubePlayer, isYouTubeReady, room?.isPlaying, isHost])

  // rAF loop for smooth progress
  useEffect(() => {
    let active = true
    let lastUpdate = 0
    const tick = () => {
      if (!active) return
      const now = performance.now()
      if (now - lastUpdate >= 100) {
        lastUpdate = now
        if (isYouTubeMode && youTubePlayer && isYouTubeReady) {
          setSmoothTime(youTubePlayer.getCurrentTime())
          setIsAudioPlaying(youTubePlayer.getPlayerState() === window.YT?.LoadingState.PLAYING)
        } else {
          const audio = audioRef.current
          if (audio) {
            setSmoothTime(audio.currentTime)
            setIsAudioPlaying(!audio.paused && !audio.ended)
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [audioRef, isYouTubeMode, youTubePlayer, isYouTubeReady])

  const handleSeek = useCallback((value: number[]) => {
    if (isYouTubeMode && youTubePlayer) {
      youTubePlayer.seekTo(value[0], true)
      if (socket) {
        socket.emit('seek', value[0])
      }
    } else {
      onSeek(value[0])
    }
  }, [onSeek, isYouTubeMode, youTubePlayer, socket])

  const handlePlayPause = useCallback(() => {
    if (isYouTubeMode && youTubePlayer) {
      if (isAudioPlaying) {
        youTubePlayer.pauseVideo()
        onPause()
      } else {
        youTubePlayer.playVideo()
        onPlay()
      }
    } else {
      if (isAudioPlaying) {
        onPause()
      } else {
        onPlay()
      }
    }
  }, [isYouTubeMode, youTubePlayer, isAudioPlaying, onPlay, onPause])

  const toggleMute = useCallback(() => {
    if (isYouTubeMode && youTubePlayer) {
      const isMutedNow = youTubePlayer.isMuted?.()
      if (isMutedNow) {
        youTubePlayer.unMute()
        setIsMuted(false)
      } else {
        youTubePlayer.mute()
        setIsMuted(true)
      }
    } else if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [audioRef, isMuted, isYouTubeMode, youTubePlayer])

  const handleVolumeChange = useCallback((value: number[]) => {
    const vol = value[0]
    if (vol > 0 && isMuted) {
      setIsMuted(false)
      if (isYouTubeMode && youTubePlayer) {
        youTubePlayer.unMute()
        youTubePlayer.setVolume(vol * 100)
      } else if (audioRef.current) {
        audioRef.current.muted = false
        audioRef.current.volume = vol
      }
    } else {
      setVolume(vol)
      if (isYouTubeMode && youTubePlayer) {
        youTubePlayer.setVolume(vol * 100)
      } else if (audioRef.current) {
        audioRef.current.volume = vol
      }
    }
  }, [audioRef, isMuted, isYouTubeMode, youTubePlayer])

  // Search YouTube (URL extraction or API search by name)
  const searchYouTube = useCallback(async (query: string) => {
    if (!query.trim()) return
    setIsSearching(true)
    setSearchResults([])
    try {
      // First, try to extract video IDs from URLs user pastes
      const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/gi
      const matches = [...query.matchAll(youtubeRegex)]
      
      if (matches.length > 0) {
        const videoId = matches[0][1]
        setSearchResults([{
          id: videoId,
          title: 'Vídeo do YouTube',
          artist: 'YouTube',
          duration: 0,
          thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        }])
      } else {
        // If not a URL, use the API to search by name
        const results = await searchYouTubeApi(query)
        setSearchResults(results.map(r => ({
          id: r.id,
          title: r.title,
          artist: r.channelTitle,
          duration: 0,
          thumbnail: r.thumbnail,
        })))
      }
    } catch (error: any) {
      console.error('YouTube search error:', error)
      alert(`Erro na busca: ${error.message || 'Verifique se a chave de API está configurada no Vercel.'}`)
    } finally {
      setIsSearching(false)
    }
  }, [])

  const selectYouTubeVideo = useCallback((videoId: string) => {
    console.log('[MusicPlayer] Selecting YouTube video:', videoId, 'Socket connected:', !!socket);
    if (!socket) {
      console.error('[MusicPlayer] Socket is null, cannot emit change-track');
      alert('Conexão perdida. Recarregue a página.');
      return;
    }
    
    try {
      console.log('[MusicPlayer] Emitting change-track event');
      socket.emit('change-track', {
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: 'youtube',
      });
    } catch (err) {
      console.error('[MusicPlayer] Error emitting event:', err);
    }
    
    setShowSearch(false);
    setSearchResults([]);
    setSearchQuery('');
  }, [socket]);

  // Volume popup state
  const [showVolume, setShowVolume] = useState(false)
  const volumePopupRef = useRef<HTMLDivElement>(null)
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggleVolumePopup = useCallback(() => {
    setShowVolume((prev) => {
      if (prev && volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current)
        volumeTimeoutRef.current = null
      }
      return !prev
    })
  }, [])

  const scheduleVolumeClose = useCallback(() => {
    if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current)
    volumeTimeoutRef.current = setTimeout(() => setShowVolume(false), 2500)
  }, [])

  const cancelVolumeClose = useCallback(() => {
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current)
      volumeTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!showVolume) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const popup = volumePopupRef.current
      if (popup && !popup.contains(e.target as Node)) {
        setShowVolume(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside, { passive: true })
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [showVolume])

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const showPlaying = isHost ? (room?.isPlaying ?? false) : isAudioPlaying
  const hasSyncedLyrics = currentTrack?.lyrics ? isLrcFormat(currentTrack.lyrics) : false
  const maxTime = isYouTubeMode && youTubePlayer ? youTubePlayer.getDuration?.() || 100 : (currentTrack?.duration || 100)

  return (
    <div className="w-full">
      {/* Hidden YouTube player container */}
      {isYouTubeMode && (
        <div ref={playerContainerRef} className="absolute opacity-0 pointer-events-none -z-10" style={{ width: '1px', height: '1px' }} />
      )}

      {/* Source indicator and search toggle */}
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div className="flex items-center gap-2">
          {isYouTubeMode ? (
            <span className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
              <Youtube className="w-3 h-3" />
              YouTube
            </span>
          ) : currentTrack?.source === 'local' ? (
            <span className="text-[10px] bg-zinc-700 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
              <Music className="w-3 h-3" />
              Local
            </span>
          ) : null}
        </div>
        {isHost && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSearch(!showSearch)}
            className="h-7 text-xs text-zinc-400 hover:text-white"
          >
            {showSearch ? <X className="w-3 h-3 mr-1" /> : <Search className="w-3 h-3 mr-1" />}
            {showSearch ? 'Cancelar' : 'YouTube'}
          </Button>
        )}
      </div>

      {/* YouTube Search Panel */}
      {showSearch && isHost && (
        <div className="mb-3 sm:mb-4 p-3 bg-zinc-800/50 border border-zinc-700/50 rounded-xl">
          <div className="flex gap-2 mb-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cole URL ou busque no YouTube..."
              className="flex-1 bg-zinc-900 border-zinc-700 text-sm h-9"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  searchYouTube(searchQuery)
                }
              }}
            />
            <Button
              onClick={() => searchYouTube(searchQuery)}
              disabled={isSearching || !searchQuery.trim()}
              size="sm"
              className="h-9 bg-rose-600 hover:bg-rose-700"
            >
              {isSearching ? '...' : 'Buscar'}
            </Button>
          </div>
          {searchResults.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => selectYouTubeVideo(result.id)}
                  className="w-full flex items-center gap-3 p-2 bg-zinc-900/50 hover:bg-zinc-700/50 rounded-lg transition-colors text-left"
                >
                  <img
                    src={result.thumbnail}
                    alt={result.title}
                    className="w-16 h-12 object-cover rounded"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{result.title}</p>
                    <p className="text-xs text-zinc-500 truncate">{result.artist}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchQuery && !isSearching && searchResults.length === 0 && (
            <p className="text-xs text-zinc-500 text-center py-2">
              Cole uma URL do YouTube ou digite para buscar
            </p>
          )}
        </div>
      )}

      {/* Now playing info */}
      <div className="flex items-center gap-3 sm:gap-3 mb-2 sm:mb-4 min-w-0">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
          {isYouTubeMode ? (
            <Youtube className="w-5 h-5 sm:w-6 sm:h-6 text-red-500" />
          ) : (
            <div className={`w-4 h-4 sm:w-3.5 sm:h-3.5 rounded-full ${currentTrack ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'}`} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm sm:text-sm font-semibold text-white truncate">
            {currentTrack?.name || 'Nenhuma musica selecionada'}
            {hasSyncedLyrics && (
              <FileText className="w-3 h-3 text-rose-400 ml-1.5 inline-block" title="Letra sincronizada" />
            )}
          </p>
          <p className="text-xs sm:text-xs text-zinc-500 truncate">
            {currentTrack?.artist || 'Adicione musicas para comecar'}
          </p>
        </div>
        {/* Volume */}
        <div ref={volumePopupRef} className="relative flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              toggleVolumePopup()
            }}
            className="text-zinc-400 hover:text-white h-9 w-9 rounded-full"
          >
            <VolumeIcon className="w-4 h-4" />
          </Button>

          {/* Volume slider popup */}
          {showVolume && (
            <div
              className="absolute bottom-full right-0 mb-2 bg-zinc-800 border border-zinc-700/50 rounded-xl p-3 shadow-xl shadow-black/50 z-50"
              onMouseEnter={cancelVolumeClose}
              onMouseLeave={scheduleVolumeClose}
              onTouchStart={cancelVolumeClose}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-2" style={{ height: '120px' }}>
                <button
                  onClick={toggleMute}
                  className="text-zinc-400 hover:text-white transition-colors active:scale-90"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  min={0}
                  step={0.01}
                  onValueChange={(v) => {
                    handleVolumeChange(v)
                    cancelVolumeClose()
                    scheduleVolumeClose()
                  }}
                  onPointerDown={cancelVolumeClose}
                  orientation="vertical"
                  className="h-[70px] [&_[data-slot=slider-track]]:w-1.5 [&_[data-slot=slider-thumb]]:h-5 [&_[data-slot=slider-thumb]]:w-5 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 [&_[data-slot=slider-range]]:bg-rose-500"
                />
                <span className="text-[10px] text-zinc-500 font-medium tabular-nums">
                  {Math.round((isMuted ? 0 : volume) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1 mb-2 sm:mb-3">
        <Slider
          value={[smoothTime]}
          max={currentTrack?.duration || 100}
          step={0.1}
          onValueChange={currentTrack ? handleSeek : undefined}
          disabled={!currentTrack}
          className="w-full [&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-thumb]]:h-5 [&_[data-slot=slider-thumb]]:w-5 sm:[&_[data-slot=slider-thumb]]:h-4 sm:[&_[data-slot=slider-thumb]]:w-4 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:ring-rose-500/30 [&_[data-slot=slider-thumb]]:ring-offset-0 sm:[&_[data-slot=slider-thumb]]:ring-0 [&_[data-slot=slider-range]]:bg-rose-500"
        />
        <div className="flex justify-between text-xs sm:text-xs text-zinc-500">
          <span>{formatTime(smoothTime)}</span>
          <span>{currentTrack ? formatTime(currentTrack.duration) : '0:00'}</span>
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-5 sm:gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onPrevious}
          disabled={!currentTrack}
          className="text-zinc-400 hover:text-white h-11 w-11 sm:h-10 sm:w-10 rounded-full active:scale-95"
        >
          <SkipBack className="w-5 h-5 sm:w-4 sm:h-4" />
        </Button>

        <Button
          size="icon"
          onClick={showPlaying ? onPause : onPlay}
          disabled={!currentTrack}
          className="h-14 w-14 sm:h-14 sm:w-14 rounded-full bg-white text-zinc-900 hover:bg-zinc-200 shadow-lg shadow-white/10 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
        >
          {showPlaying ? <Pause className="w-6 h-6 sm:w-6 sm:h-6" /> : <Play className="w-6 h-6 sm:w-6 sm:h-6 ml-0.5" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onNext}
          disabled={!currentTrack}
          className="text-zinc-400 hover:text-white h-11 w-11 sm:h-10 sm:w-10 rounded-full active:scale-95"
        >
          <SkipForward className="w-5 h-5 sm:w-4 sm:h-4" />
        </Button>
      </div>

      {!isHost && currentTrack && (
        <p className="text-[10px] text-zinc-600 text-center mt-1.5">
          Suas alteracoes sincronizam com todos os usuarios
        </p>
      )}
    </div>
  )
}
