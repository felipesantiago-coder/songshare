'use client'

import { motion } from 'framer-motion'
import { Crown, Users, Copy, Check, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSongShareStore } from '@/store/songshare'
import { useState, useCallback } from 'react'

interface UserListProps {
  onLeave: () => void
}

export function UserList({ onLeave }: UserListProps) {
  const { room, roomCode, socket } = useSongShareStore()
  const [copied, setCopied] = useState(false)

  const isHost = room?.hostId === socket?.id

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const textArea = document.createElement('textarea')
      textArea.value = roomCode
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [roomCode])

  return (
    <div className="space-y-4">
      {/* Room code */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              onClick={copyCode}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                <span className="text-lg font-mono font-bold tracking-[0.2em] text-white">
                  {roomCode}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-zinc-500 hover:text-white rounded-md"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Clique para copiar o codigo</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Users */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">
            Ouvintes
          </span>
          <Badge
            variant="secondary"
            className="bg-zinc-800 text-zinc-400 text-xs px-1.5 py-0 h-4"
          >
            {room?.users.length || 0}
          </Badge>
        </div>

        <div className="space-y-1">
          {room?.users.map((user, index) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800/30"
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="bg-zinc-800 text-zinc-400 text-[10px] font-medium">
                  {user.username.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-zinc-300 flex-1 truncate">
                {user.username}
                {user.id === socket?.id && (
                  <span className="text-zinc-600 ml-1">(voce)</span>
                )}
              </span>
              {user.isHost && (
                <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] px-1.5 py-0 h-4 gap-0.5">
                  <Crown className="w-2.5 h-2.5" />
                  Host
                </Badge>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Leave room button */}
      <Button
        variant="outline"
        onClick={onLeave}
        className="w-full border-zinc-700/50 text-zinc-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 rounded-lg text-xs h-8 mt-2"
      >
        <LogOut className="w-3.5 h-3.5 mr-1.5" />
        Sair da sala
      </Button>
    </div>
  )
}
