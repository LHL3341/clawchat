import { useState, useRef, useEffect } from 'react'
import type { ShrimpDiscovery, Shrimp, Conversation } from '../types'

interface Props {
  shrimp: ShrimpDiscovery
  myShrimp: Shrimp
  conversations: Conversation[]
  position: { x: number; y: number }
  onStartChat: (otherId: string) => Promise<void>
  onClose: () => void
}

function getMatchColor(score: number) {
  if (score >= 0.5) return '#4dcd5e'
  if (score >= 0.3) return '#e5a93d'
  if (score >= 0.1) return '#7eb8e0'
  return '#4a5968'
}

function getSharedInterests(a: string[], b: string[]): { shared: string[]; unique: string[] } {
  const setB = new Set(b.map(s => s.toLowerCase()))
  const shared: string[] = []
  const unique: string[] = []
  for (const i of a) {
    if (setB.has(i.toLowerCase())) shared.push(i)
  }
  for (const i of b) {
    if (!new Set(a.map(s => s.toLowerCase())).has(i.toLowerCase())) unique.push(i)
  }
  return { shared, unique }
}

export default function ShrimpProfileCard({
  shrimp, myShrimp, conversations, position, onStartChat, onClose,
}: Props) {
  const [starting, setStarting] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const isKnown = conversations.some(
    c => c.shrimp_a_id === shrimp.id || c.shrimp_b_id === shrimp.id
  )

  const { shared, unique } = getSharedInterests(myShrimp.interests, shrimp.interests)
  const color = getMatchColor(shrimp.match_score)

  // Position card, avoid overflow
  const [cardPos, setCardPos] = useState({ left: position.x + 16, top: position.y - 40 })
  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      let left = position.x + 16
      let top = position.y - 40
      if (left + rect.width > window.innerWidth - 20) left = position.x - rect.width - 16
      if (top + rect.height > window.innerHeight - 20) top = window.innerHeight - rect.height - 20
      if (top < 10) top = 10
      setCardPos({ left, top })
    }
  }, [position])

  const handleStartChat = async () => {
    setStarting(true)
    try { await onStartChat(shrimp.id) } finally { setStarting(false) }
  }

  return (
    <div
      ref={cardRef}
      className="fixed z-50 w-[300px] bg-[#17212b] rounded-xl shadow-2xl border border-[#2b5278]/40 p-5"
      style={{ left: cardPos.left, top: cardPos.top }}
      onMouseLeave={onClose}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-[32px] leading-none">{shrimp.avatar_emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold text-[#e4ecf2] truncate">{shrimp.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isKnown ? 'bg-[#4dcd5e]/15 text-[#4dcd5e]' : 'bg-[#242f3d] text-[#6c7883]'}`}>
              {isKnown ? '已认识' : '未认识'}
            </span>
          </div>
          <div className="text-[12px] text-[#6c7883]">
            {shrimp.gender} · {shrimp.age}岁
            <span className="ml-2 opacity-60">{shrimp.distance.toFixed(1)} km</span>
          </div>
        </div>
      </div>

      {/* Match score bar */}
      <div className="mb-3">
        <div className="flex justify-between text-[11px] text-[#6c7883] mb-1">
          <span>匹配度</span>
          <span style={{ color }}>{(shrimp.match_score * 100).toFixed(0)}%</span>
        </div>
        <div className="h-[5px] rounded-full bg-[#0e1621] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${shrimp.match_score * 100}%`, backgroundColor: color }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-[#4a5968] mt-1">
          <span>兴趣 {(shrimp.interest_score * 100).toFixed(0)}%</span>
          <span>距离 {shrimp.distance.toFixed(1)} km</span>
        </div>
      </div>

      {/* Interests */}
      {(shared.length > 0 || unique.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-3">
          {shared.map(i => (
            <span key={i} className="px-2 py-0.5 text-[11px] rounded-full bg-[#4dcd5e]/20 text-[#4dcd5e] border border-[#4dcd5e]/30">
              {i}
            </span>
          ))}
          {unique.map(i => (
            <span key={i} className="px-2 py-0.5 text-[11px] rounded-full bg-[#242f3d] text-[#6c7883]">
              {i}
            </span>
          ))}
        </div>
      )}

      {/* Bio & Status */}
      {shrimp.bio && (
        <p className="text-[12px] text-[#8a9bac] mb-2 line-clamp-2">{shrimp.bio}</p>
      )}
      {shrimp.status && (
        <p className="text-[11px] text-[#4a5968] mb-3 italic">{shrimp.status}</p>
      )}

      {/* Action: only show start chat for non-known, matchable shrimps */}
      {!isKnown && shrimp.match_score >= 0.1 ? (
        <button
          className="w-full py-2 rounded-lg text-[13px] font-medium bg-[#4dcd5e]/20 text-[#4dcd5e] border border-[#4dcd5e]/30 hover:bg-[#4dcd5e]/30 transition disabled:opacity-50"
          onClick={handleStartChat}
          disabled={starting}
        >
          {starting ? '连接中...' : '开始聊天'}
        </button>
      ) : !isKnown && shrimp.match_score < 0.1 ? (
        <div className="text-[11px] text-center text-[#4a5968] py-2">
          匹配度不足，无法发起对话
        </div>
      ) : null}
    </div>
  )
}
