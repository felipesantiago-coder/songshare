"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Loader2, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useSongShareStore } from "@/store/songshare-store";
import { cn } from "@/lib/utils";
import YouTubePlayer from "./YouTubePlayer"; // Certifique-se que este componente existe
import Playlist from "./Playlist";
import LyricsView from "./LyricsView";
import { searchYouTube } from "@/lib/youtube-search";

interface Track {
  id: string;
  title: string;
  artist: string;
  url?: string;
  source: 'file' | 'youtube';
  duration: number;
  thumbnail?: string;
}

export default function MusicPlayer() {
  const { 
    socket, 
    isHost, 
    room, 
    currentTrack, 
    isPlaying, 
    currentTime, 
    duration, 
    volume,
    playlist,
    isConnected 
  } = useSongShareStore();

  const [localVolume, setLocalVolume] = useState(volume);
  const [isMuted, setIsMuted] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  
  // Refs para controle do player
  const playerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  // Sincroniza volume local com o global
  useEffect(() => {
    setLocalVolume(volume);
    if (playerRef.current) {
      playerRef.current.setVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);

  // Função corrigida para selecionar vídeo do YouTube
  const selectYouTubeVideo = useCallback(async (videoId: string, title: string, artist: string, url: string) => {
    console.log("[MusicPlayer] Tentando selecionar vídeo:", videoId);

    // CORREÇÃO CRÍTICA: Obter socket fresco e verificar APENAS conexão
    const freshSocket = useSongShareStore.getState().socket;
    
    if (!freshSocket || !freshSocket.connected) {
      console.error("[MusicPlayer] Socket inválido ou desconectado.", { 
        exists: !!freshSocket, 
        connected: freshSocket?.connected 
      });
      alert("Conexão perdida. Recarregue a página.");
      return;
    }

    console.log("[MusicPlayer] Socket válido. Emitindo evento change-track...");

    // Emite o evento para o host (ou para si mesmo se for host)
    freshSocket.emit("change-track", {
      roomId: room?.id,
      track: {
        id: `yt-${videoId}`,
        title,
        artist,
        source: 'youtube',
        url,
        duration: 0, // Será atualizado pelo player
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
      }
    });

    setIsSearchOpen(false);
    setSearchResults([]);
    setSearchQuery("");
  }, [room?.id]);

  // Handler para busca por nome
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsLoadingSearch(true);
    try {
      const results = await searchYouTube(searchQuery);
      setSearchResults(results);
    } catch (error) {
      console.error("Erro na busca:", error);
      alert("Erro ao buscar vídeos. Verifique sua conexão ou a API Key.");
    } finally {
      setIsLoadingSearch(false);
    }
  };

  // Handler para upload de arquivo local
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket || !room) return;

    const objectUrl = URL.createObjectURL(file);
    const track: Track = {
      id: `file-${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: "Arquivo Local",
      url: objectUrl,
      source: 'file',
      duration: 0,
    };

    socket.emit("change-track", {
      roomId: room.id,
      track
    });
  };

  // Controles de Reprodução
  const togglePlay = () => {
    if (!socket || !room) return;
    socket.emit("toggle-play", { roomId: room.id, play: !isPlaying });
  };

  const handleSeek = (value: number[]) => {
    if (!socket || !room) return;
    socket.emit("seek", { roomId: room.id, time: value[0] });
  };

  const handleVolumeChange = (value: number[]) => {
    const newVol = value[0];
    setLocalVolume(newVol);
    useSongShareStore.getState().setVolume(newVol);
    if (playerRef.current) {
      playerRef.current.setVolume(isMuted ? 0 : newVol);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 space-y-6">
      {/* Área Principal do Player */}
      <div className="bg-card rounded-xl shadow-lg overflow-hidden border border-border">
        
        {/* Capa / Visualizador */}
        <div className="relative aspect-video bg-muted flex items-center justify-center group">
          {currentTrack?.source === 'youtube' && currentTrack.url ? (
            <YouTubePlayer 
              ref={playerRef}
              videoUrl={currentTrack.url}
              isPlaying={isPlaying}
              volume={isMuted ? 0 : volume}
              onStateChange={(state) => {
                // Lógica de sincronização de estado se necessária
              }}
            />
          ) : currentTrack?.thumbnail ? (
            <img 
              src={currentTrack.thumbnail} 
              alt={currentTrack.title} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground flex flex-col items-center">
              <Volume2 className="w-16 h-16 mb-2 opacity-50" />
              <span>Nenhuma música tocando</span>
            </div>
          )}
          
          {/* Overlay de Controles Rápidos (Mobile) */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
             {/* Botões extras se necessário */}
          </div>
        </div>

        {/* Informações e Controles */}
        <div className="p-6 space-y-4">
          
          {/* Info da Faixa */}
          <div className="flex justify-between items-start">
            <div className="space-y-1 overflow-hidden">
              <h2 className="text-xl font-bold truncate">{currentTrack?.title || "Aguardando..."}</h2>
              <p className="text-sm text-muted-foreground truncate">{currentTrack?.artist || ""}</p>
            </div>
            
            {/* Ações do Host */}
            {isHost && (
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setIsSearchOpen(!isSearchOpen)}
                  title="Buscar no YouTube"
                >
                  <Youtube className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  title="Enviar Arquivo"
                >
                  <SkipForward className="w-4 h-4 rotate-90" /> {/* Ícone genérico de upload */}
                </Button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="audio/*" 
                  onChange={handleFileUpload}
                />
              </div>
            )}
          </div>

          {/* Barra de Progresso */}
          <div className="space-y-2">
            <Slider 
              value={[currentTime]} 
              max={duration || 100} 
              step={1} 
              onValueChange={handleSeek}
              disabled={!isHost && !currentTrack} 
              className="cursor-pointer"
            />
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>{new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
              <span>{new Date((duration || 0) * 1000).toISOString().substr(14, 5)}</span>
            </div>
          </div>

          {/* Controles Principais */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={toggleMute}>
                {isMuted || localVolume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>
              <Slider 
                value={[localVolume]} 
                max={100} 
                step={1} 
                onValueChange={handleVolumeChange}
                className="w-24 hidden sm:flex"
              />
            </div>

            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" disabled={!isHost}>
                <SkipBack className="w-5 h-5" />
              </Button>
              
              <Button 
                size="lg" 
                className="rounded-full w-14 h-14" 
                onClick={togglePlay}
                disabled={!currentTrack}
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
              </Button>
              
              <Button variant="ghost" size="icon" disabled={!isHost}>
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>

            <div className="w-32 hidden md:block"></div> {/* Spacer para centralizar */}
          </div>
        </div>
      </div>

      {/* Modal de Busca do YouTube */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center pt-20 p-4">
          <div className="bg-card w-full max-w-2xl rounded-lg shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Buscar no YouTube</h3>
              <Button variant="ghost" size="sm" onClick={() => setIsSearchOpen(false)}>Fechar</Button>
            </div>
            
            <form onSubmit={handleSearch} className="flex gap-2">
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Digite o nome da música ou artista..."
                className="flex-1 px-4 py-2 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
              <Button type="submit" disabled={isLoadingSearch}>
                {isLoadingSearch ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
              </Button>
            </form>

            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-2">
              {searchResults.length === 0 && !isLoadingSearch && (
                <p className="text-center text-muted-foreground py-8">Digite algo para buscar vídeos.</p>
              )}
              
              {searchResults.map((video) => (
                <div 
                  key={video.id}
                  onClick={() => selectYouTubeVideo(video.id, video.title, video.channelTitle, `https://www.youtube.com/watch?v=${video.id}`)}
                  className="flex gap-4 p-3 hover:bg-accent rounded-md cursor-pointer transition-colors group"
                >
                  <img src={video.thumbnail} alt="" className="w-24 h-16 object-cover rounded" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate group-hover:text-primary">{video.title}</h4>
                    <p className="text-sm text-muted-foreground truncate">{video.channelTitle}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lista de Reprodução e Letras (Simplificado para este exemplo) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Playlist />
        <LyricsView />
      </div>
    </div>
  );
}
