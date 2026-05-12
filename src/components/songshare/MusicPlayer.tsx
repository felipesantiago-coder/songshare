"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, SkipForward, SkipBack, Volume2, Search, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { useSongShareStore } from "@/store/songshare";
import { cn } from "@/lib/utils";
import { searchYouTube, type YouTubeVideo } from "@/lib/youtube-search";

interface Track {
  id: string;
  title: string;
  artist: string;
  url?: string;
  source: 'file' | 'youtube';
  duration?: number;
  thumbnail?: string;
}

export function MusicPlayer() {
  // Usamos apenas os setters e estados essenciais aqui para evitar re-renders excessivos
  const { 
    isHost, 
    currentTrack, 
    isPlaying, 
    volume,
    setCurrentTrack,
    setIsPlaying,
    setVolume,
  } = useSongShareStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YouTubeVideo[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const youtubePlayerRef = useRef<any>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Efeito para carregar a API do YouTube
  useEffect(() => {
    if (currentTrack?.source === 'youtube' && !youtubePlayerRef.current && typeof window !== 'undefined' && (window as any).YT) {
      initYouTubePlayer();
    } else if (currentTrack?.source === 'file' && audioRef.current) {
       if (isPlaying) audioRef.current.play().catch(e => console.error("Erro play:", e));
       else audioRef.current.pause();
    }
  }, [currentTrack]);

  // Sincronizar play/pause
  useEffect(() => {
    if (currentTrack?.source === 'file' && audioRef.current) {
      if (isPlaying) audioRef.current.play().catch(e => console.error("Sync play error:", e));
      else audioRef.current.pause();
    } else if (currentTrack?.source === 'youtube' && youtubePlayerRef.current) {
      if (isPlaying) youtubePlayerRef.current.playVideo();
      else youtubePlayerRef.current.pauseVideo();
    }
  }, [isPlaying, currentTrack]);

  const initYouTubePlayer = () => {
    if (!currentTrack?.url) return;
    
    const videoId = extractVideoId(currentTrack.url);
    if (!videoId) return;

    // Destruir player anterior se existir
    if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
    }

    youtubePlayerRef.current = new (window as any).YT.Player('youtube-player-container', {
      height: '0',
      width: '0',
      videoId: videoId,
      playerVars: {
        autoplay: isPlaying ? 1 : 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      },
    });
  };

  const onPlayerReady = (event: any) => {
    const player = event.target;
    setDuration(player.getDuration());
    if (isPlaying) player.playVideo();
    updateTimeLoop();
  };

  const onPlayerStateChange = (event: any) => {
    if (event.data === (window as any).YT.PlayerState.ENDED) {
      handleSkipForward();
    }
  };

  const updateTimeLoop = () => {
    if (youtubePlayerRef.current) {
      setCurrentTime(youtubePlayerRef.current.getCurrentTime());
      setTimeout(updateTimeLoop, 1000);
    }
  };

  const extractVideoId = (url: string) => {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/))([^&?#/]+)/);
    return match ? match[1] : null;
  };

  const handlePlayPause = () => {
    // CORREÇÃO: Obter socket fresco no momento do clique
    const { socket } = useSongShareStore.getState();
    
    if (!socket || !socket.connected) {
      console.warn("[MusicPlayer] Socket desconectado no play/pause.");
      return;
    }

    if (isHost) {
      socket.emit('play-pause', !isPlaying);
    } else {
      socket.emit('request-play-pause');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await searchYouTube(searchQuery);
      setSearchResults(results);
    } catch (error) {
      console.error("Erro na busca:", error);
      alert("Erro ao buscar. Verifique se a API Key do YouTube está configurada no Vercel.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectVideo = (video: YouTubeVideo) => {
    // CORREÇÃO CRÍTICA: Obter socket fresco diretamente do store global
    const { socket } = useSongShareStore.getState();

    if (!socket || !socket.connected) {
      console.error("[MusicPlayer] Socket inválido ou desconectado. Não foi possível selecionar o vídeo.");
      // Opcional: Mostrar toast para o usuário
      return;
    }

    const track: Track = {
      id: `yt-${video.id}-${Date.now()}`,
      title: video.title,
      artist: video.channelTitle,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      source: 'youtube',
      thumbnail: video.thumbnail,
    };

    console.log("[MusicPlayer] Emitindo seleção de vídeo:", video.title, "IsHost:", isHost);

    if (isHost) {
      // Host muda a faixa diretamente
      socket.emit('change-track', track);
    } else {
      // Guest solicita mudança
      socket.emit('request-track-change', track);
    }
    
    setSearchResults([]);
    setShowSearch(false);
    setSearchQuery("");
  };

  const handleSkipForward = () => {
     const { socket } = useSongShareStore.getState();
     if (isHost && socket) {
        // Lógica simplificada: pula para a próxima da playlist se existir
        // Em uma implementação completa, você gerenciaria o índice da playlist aqui
        console.log("Skip forward logic here");
     }
  };

  const handleVolumeChange = (val: number[]) => {
    const newVol = val[0];
    setVolume(newVol);
    if (audioRef.current) audioRef.current.volume = newVol / 100;
    if (youtubePlayerRef.current) youtubePlayerRef.current.setVolume(newVol);
    
    const { socket } = useSongShareStore.getState();
    if (socket && isHost) {
      socket.emit('volume-change', newVol);
    }
  };

  return (
    <div className="w-full bg-zinc-900/50 backdrop-blur-md border-t border-zinc-800 p-4 flex flex-col gap-4">
      
      {/* Área de Busca YouTube */}
      {showSearch && (
        <div className="flex gap-2 animate-in fade-in slide-in-from-bottom-4">
          <Input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar música no YouTube..."
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="bg-zinc-800 border-zinc-700 text-white"
          />
          <Button onClick={handleSearch} disabled={isSearching} size="icon">
            <Search className="w-4 h-4" />
          </Button>
          <Button variant="ghost" onClick={() => setShowSearch(false)}>Cancelar</Button>
        </div>
      )}

      {/* Resultados da Busca */}
      {searchResults.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto bg-zinc-900 p-2 rounded-md border border-zinc-800">
          {searchResults.map((video) => (
            <div 
              key={video.id}
              onClick={() => handleSelectVideo(video)}
              className="flex items-center gap-3 p-2 hover:bg-zinc-800 rounded cursor-pointer transition-colors"
            >
              <img src={video.thumbnail} alt={video.title} className="w-16 h-12 object-cover rounded" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-white truncate">{video.title}</h4>
                <p className="text-xs text-zinc-400 truncate">{video.channelTitle}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Controles Principais */}
      <div className="flex items-center justify-between gap-4">
        
        {/* Info da Música */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {currentTrack?.thumbnail ? (
             <img src={currentTrack.thumbnail} alt="Capa" className="w-12 h-12 rounded object-cover bg-zinc-800" />
          ) : (
             <div className="w-12 h-12 rounded bg-zinc-800 flex items-center justify-center">
               {currentTrack?.source === 'youtube' ? <Youtube className="text-red-500" /> : <Volume2 />}
             </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">
              {currentTrack ? currentTrack.title : "Nenhuma música selecionada"}
            </h3>
            <p className="text-xs text-zinc-400 truncate">
              {currentTrack ? currentTrack.artist : "Aguardando..."}
            </p>
          </div>
        </div>

        {/* Botões de Controle */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setShowSearch(!showSearch)}>
            <Search className="w-5 h-5" />
          </Button>
          
          <Button variant="ghost" size="icon" onClick={handleSkipForward}>
            <SkipBack className="w-5 h-5" />
          </Button>
          
          <Button 
            size="icon" 
            className="w-10 h-10 rounded-full bg-white text-black hover:bg-zinc-200"
            onClick={handlePlayPause}
            disabled={!currentTrack}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-1" />}
          </Button>
          
          <Button variant="ghost" size="icon" onClick={handleSkipForward}>
            <SkipForward className="w-5 h-5" />
          </Button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2 w-32 hidden md:flex">
          <Volume2 className="w-4 h-4 text-zinc-400" />
          <Slider 
            value={[volume]} 
            max={100} 
            step={1} 
            onValueChange={handleVolumeChange}
            className="cursor-pointer"
          />
        </div>
      </div>

      {/* Container Invisível para o Player do YouTube */}
      <div id="youtube-player-container" className="hidden" />
      
      {/* Elemento de Áudio para Arquivos Locais */}
      <audio 
        ref={audioRef} 
        src={currentTrack?.source === 'file' ? currentTrack.url : undefined}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => handleSkipForward()}
      />
    </div>
  );
}
