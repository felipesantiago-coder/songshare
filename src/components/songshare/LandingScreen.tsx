'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Music, Plus, ArrowRight, Headphones } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useSongShareStore } from '@/store/songshare'

interface LandingScreenProps {
  onCreateRoom: () => void
  onJoinRoom: (code: string) => void
  isConnected: boolean
}

export function LandingScreen({ onCreateRoom, onJoinRoom, isConnected }: LandingScreenProps) {
  const [joinCode, setJoinCode] = useState('')
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')
  const { username, setUsername } = useSongShareStore()

  const canJoin = joinCode.trim().length >= 4 && isConnected

  const handleJoin = useCallback(() => {
    if (canJoin) {
      onJoinRoom(joinCode.trim())
    }
  }, [canJoin, joinCode, onJoinRoom])

  const canProceed = username.trim().length >= 2

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Animated background particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full bg-rose-500/5"
            style={{
              width: 100 + i * 80,
              height: 100 + i * 80,
              left: `${15 + i * 14}%`,
              top: `${10 + (i % 3) * 30}%`,
            }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.6, 0.3],
            }}
            transition={{
              duration: 4 + i,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.5,
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 shadow-lg shadow-rose-500/25 mb-4">
            <Headphones className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">SongShare</h1>
          <p className="text-zinc-400 mt-2 text-sm">
            Ouca musica com seus amigos, em sincronia
          </p>
        </motion.div>

        <Card className="bg-zinc-900/80 border-zinc-800 backdrop-blur-xl shadow-2xl">
          <CardContent className="p-6">
            <AnimatePresence mode="wait">
              {mode === 'choose' && (
                <motion.div
                  key="choose"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">
                      Seu nome
                    </label>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Digite seu nome..."
                      className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-rose-500/50 focus:ring-rose-500/20 h-11"
                      maxLength={20}
                    />
                  </div>

                  <div className="space-y-3 pt-2">
                    <Button
                      onClick={() => canProceed && setMode('create')}
                      disabled={!canProceed}
                      className="w-full h-12 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-medium rounded-xl transition-all duration-200 shadow-lg shadow-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Criar uma sala
                    </Button>

                    <Button
                      onClick={() => canProceed && setMode('join')}
                      disabled={!canProceed}
                      variant="outline"
                      className="w-full h-12 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white font-medium rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Music className="w-4 h-4 mr-2" />
                      Entrar em uma sala
                    </Button>
                  </div>

                  {!isConnected && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-xs text-amber-400 text-center mt-3"
                    >
                      Conectando ao servidor...
                    </motion.p>
                  )}
                </motion.div>
              )}

              {mode === 'create' && (
                <motion.div
                  key="create"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-white">Criar sala</h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      Voce sera o host e controlara a reproducao
                    </p>
                  </div>

                  <div className="bg-zinc-800/50 rounded-xl p-4 space-y-2">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider">Nome</p>
                    <p className="text-white font-medium">{username}</p>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={() => setMode('choose')}
                      variant="ghost"
                      className="flex-1 h-11 text-zinc-400 hover:text-white rounded-xl"
                    >
                      Voltar
                    </Button>
                    <Button
                      onClick={onCreateRoom}
                      disabled={!isConnected}
                      className="flex-1 h-11 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-medium rounded-xl shadow-lg shadow-rose-500/20"
                    >
                      Criar sala
                    </Button>
                  </div>
                </motion.div>
              )}

              {mode === 'join' && (
                <motion.div
                  key="join"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-white">Entrar na sala</h3>
                    <p className="text-sm text-zinc-400 mt-1">
                      Digite o codigo da sala
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="Ex: ABC123"
                      className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-rose-500/50 focus:ring-rose-500/20 h-12 text-center text-xl font-mono tracking-[0.3em] rounded-xl uppercase"
                      maxLength={6}
                      onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    />
                    {!isConnected && (
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-xs text-amber-400 text-center"
                      >
                        Reconectando ao servidor...
                      </motion.p>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={() => setMode('choose')}
                      variant="ghost"
                      className="flex-1 h-11 text-zinc-400 hover:text-white rounded-xl"
                    >
                      Voltar
                    </Button>
                    <Button
                      onClick={handleJoin}
                      disabled={!canJoin}
                      className="flex-1 h-11 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white font-medium rounded-xl shadow-lg shadow-rose-500/20"
                    >
                      <ArrowRight className="w-4 h-4 mr-2" />
                      Entrar
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-zinc-600 mt-6">
          SongShare v1.0 &mdash; Musica juntos, em qualquer lugar
        </p>
      </motion.div>
    </div>
  )
}
