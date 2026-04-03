import { useState, useEffect, useCallback, useRef } from 'react'
import type { ShrimpDiscovery, Shrimp, Conversation } from '../types'
import { api } from '../api'
import ShrimpProfileCard from './ShrimpProfileCard'

interface Props {
  myId: string
  myShrimp: Shrimp
  conversations: Conversation[]
  onStartChat: (otherId: string) => Promise<void>
  onGoToChat: (convId: string) => void
}

function stableAngle(myLat: number, myLng: number, otherLat: number, otherLng: number, id: string): number {
  // Use real geographic bearing if positions differ
  const dLat = otherLat - myLat
  const dLng = otherLng - myLng
  if (Math.abs(dLat) > 0.0001 || Math.abs(dLng) > 0.0001) {
    // Bearing: 0=North, 90=East (convert to math angle: 0=right, counter-clockwise)
    const bearing = (Math.atan2(dLng, dLat) * 180) / Math.PI // degrees from north
    return (90 - bearing + 360) % 360 // convert to math angle
  }
  // Fallback: hash ID to a stable angle
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  return ((h % 360) + 360) % 360
}

const MIN_DIST = 1
const MAX_DIST = 100
const ZOOM_STEP = 2

export default function ShrimpRadar({ myId, myShrimp, conversations, onStartChat, onGoToChat }: Props) {
  const [nearby, setNearby] = useState<ShrimpDiscovery[]>([])
  const [maxDistance, setMaxDistance] = useState(20)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<ShrimpDiscovery | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const knownIds = new Set(
    conversations.map(c => c.shrimp_a_id === myId ? c.shrimp_b_id : c.shrimp_a_id)
  )

  // Track container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fetchNearby = useCallback(async () => {
    try {
      const data = await api.discover(myId, maxDistance)
      setNearby(data)
    } catch (e) {
      console.error('Discover failed:', e)
    } finally {
      setLoading(false)
    }
  }, [myId, maxDistance])

  useEffect(() => {
    fetchNearby()
    const iv = setInterval(fetchNearby, 10000)
    return () => clearInterval(iv)
  }, [fetchNearby])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setMaxDistance(prev => {
      const delta = e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP
      return Math.round(Math.min(MAX_DIST, Math.max(MIN_DIST, prev + delta)) * 10) / 10
    })
  }, [])

  const handleDotEnter = (shrimp: ShrimpDiscovery, e: React.MouseEvent) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      setHovered(shrimp)
      setHoverPos({ x: e.clientX, y: e.clientY })
    }, 150)
  }

  const handleDotLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHovered(null), 200)
  }

  // Radar geometry: use the smaller dimension as the "radius space"
  const minDim = Math.min(containerSize.w, containerSize.h)
  const maxRadius = minDim * 0.44 // 44% of min dimension
  const cx = containerSize.w / 2
  const cy = containerSize.h / 2
  const rings = [0.25, 0.5, 0.75, 1.0]

  return (
    <div
      ref={containerRef}
      className="flex-1 h-screen bg-[#0a1018] overflow-hidden relative"
      onWheel={handleWheel}
    >
      {/* Concentric rings */}
      {rings.map(frac => {
        const r = maxRadius * frac
        return (
          <div
            key={frac}
            className="absolute rounded-full border border-[#2b5278]/20 pointer-events-none"
            style={{
              width: r * 2,
              height: r * 2,
              left: cx - r,
              top: cy - r,
              transition: 'all 0.3s ease-out',
            }}
          />
        )
      })}

      {/* Cross lines */}
      <div
        className="absolute bg-[#2b5278]/10 pointer-events-none"
        style={{ left: cx, top: cy - maxRadius, width: 1, height: maxRadius * 2, transition: 'all 0.3s ease-out' }}
      />
      <div
        className="absolute bg-[#2b5278]/10 pointer-events-none"
        style={{ left: cx - maxRadius, top: cy, width: maxRadius * 2, height: 1, transition: 'all 0.3s ease-out' }}
      />

      {/* Sweep */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: maxRadius * 2,
          height: maxRadius * 2,
          left: cx - maxRadius,
          top: cy - maxRadius,
          animation: 'radar-sweep 4s linear infinite',
          background: 'conic-gradient(from 0deg, transparent 0deg, transparent 340deg, rgba(43,82,120,0.3) 355deg, rgba(77,205,94,0.1) 360deg)',
          transition: 'width 0.3s, height 0.3s, left 0.3s, top 0.3s',
        }}
      />

      {/* Expanding pulse */}
      <div
        className="absolute rounded-full border border-[#4dcd5e]/15 pointer-events-none"
        style={{
          width: maxRadius * 2,
          height: maxRadius * 2,
          left: cx - maxRadius,
          top: cy - maxRadius,
          animation: 'radar-ring-expand 3s ease-out infinite',
        }}
      />

      {/* Distance labels on rings */}
      {rings.map(frac => (
        <span
          key={`lbl-${frac}`}
          className="absolute text-[10px] text-[#2b5278]/40 pointer-events-none font-mono"
          style={{
            left: cx + 6,
            top: cy - maxRadius * frac - 2,
            transition: 'all 0.3s ease-out',
          }}
        >
          {(maxDistance * frac).toFixed(0)}
        </span>
      ))}

      {/* Center: my avatar */}
      <div
        className="absolute z-10"
        style={{ left: cx - 20, top: cy - 20, transition: 'left 0.3s, top 0.3s' }}
      >
        <div
          className="w-10 h-10 rounded-full bg-[#17212b] border-2 border-[#4dcd5e] flex items-center justify-center text-[20px]"
          style={{ boxShadow: '0 0 20px rgba(77,205,94,0.3)' }}
        >
          {myShrimp.avatar_emoji}
        </div>
      </div>

      {/* Shrimp dots */}
      {(() => {
        return nearby.map((s) => {
          const angle = (stableAngle(myShrimp.location_lat, myShrimp.location_lng, s.location_lat, s.location_lng, s.id) * Math.PI) / 180
          // Map distance to radar radius using maxDistance as the scale
          const rFrac = Math.min(s.distance / maxDistance, 1) * 0.88 + 0.08 // 8%-96% of radar
          const r = rFrac * maxRadius
          const x = cx + r * Math.cos(angle)
          const y = cy - r * Math.sin(angle)
          const isKnown = knownIds.has(s.id)
          const isOutside = s.distance / maxDistance > 1.05
          const borderColor = isKnown ? '#4dcd5e' : '#6c7883'

        return (
          <div
            key={s.id}
            className="absolute z-20 cursor-pointer"
            style={{
              left: x,
              top: y,
              transform: 'translate(-50%, -50%)',
              transition: 'left 0.4s ease-out, top 0.4s ease-out, opacity 0.3s ease',
              opacity: isOutside ? 0 : 1,
              pointerEvents: isOutside ? 'none' : 'auto',
            }}
            onMouseEnter={e => handleDotEnter(s, e)}
            onMouseLeave={handleDotLeave}
            onClick={async () => {
              if (hoverTimer.current) clearTimeout(hoverTimer.current);
              setHovered(null);
              // Find existing conversation
              const conv = conversations.find(c => c.shrimp_a_id === s.id || c.shrimp_b_id === s.id);
              if (conv) {
                onGoToChat(conv.id);
              } else {
                await onStartChat(s.id);
              }
            }}
          >
            {isKnown && (
              <div
                className="absolute inset-[-3px] rounded-full"
                style={{ animation: 'radar-glow 2s ease-in-out infinite', border: `2px solid ${borderColor}`, opacity: 0.4 }}
              />
            )}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-[16px] transition-transform hover:scale-125"
              style={{
                backgroundColor: '#17212b',
                border: `2px solid ${borderColor}`,
                boxShadow: isKnown ? `0 0 8px ${borderColor}40` : 'none',
              }}
            >
              {s.avatar_emoji}
            </div>
            <div className="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 flex flex-col items-center">
              <span className="text-[9px] whitespace-nowrap font-medium" style={{ color: borderColor, opacity: 0.8 }}>
                {s.name}
              </span>
              <span className={`text-[8px] whitespace-nowrap ${isKnown ? 'text-[#4dcd5e]/60' : 'text-[#6c7883]/50'}`}>
                {isKnown ? '已认识' : '未认识'}
              </span>
            </div>
          </div>
        )
      })
      })()}

      {/* Empty state */}
      {!loading && nearby.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <p className="text-[14px] text-[#4a5968] text-center">
            附近暂无其他虾<br />
            <span className="text-[12px]">试试滚轮放大搜索范围</span>
          </p>
        </div>
      )}

      {/* Overlay: header */}
      <div className="absolute top-0 left-0 right-0 z-30 px-5 py-3 flex items-center justify-between pointer-events-none bg-gradient-to-b from-[#0a1018] via-[#0a1018]/70 to-transparent">
        <div className="pointer-events-auto">
          <h2 className="text-[15px] font-semibold text-[#e4ecf2]/80 flex items-center gap-2">
            📡 附近的虾
          </h2>
          <p className="text-[11px] text-[#6c7883] mt-0.5">
            {loading ? '搜索中...' : `${nearby.length} 只虾 · 滚轮缩放`}
          </p>
        </div>
        <span className="font-mono text-[12px] bg-[#17212b]/50 px-2.5 py-1 rounded text-[#e4ecf2]/60 pointer-events-auto">
          {maxDistance} km
        </span>
      </div>

      {/* Overlay: legend */}
      <div className="absolute bottom-0 left-0 right-0 z-30 px-5 py-3 flex items-center justify-center gap-5 text-[10px] text-[#6c7883]/60 pointer-events-none bg-gradient-to-t from-[#0a1018] via-[#0a1018]/50 to-transparent">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border-2 border-[#4dcd5e] bg-transparent" />已认识</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#6c7883]/60" />未认识</span>
      </div>

      {/* Hover card */}
      {hovered && (
        <ShrimpProfileCard
          shrimp={hovered}
          myShrimp={myShrimp}
          conversations={conversations}
          position={hoverPos}
          onStartChat={onStartChat}
          onClose={() => setHovered(null)}
        />
      )}
    </div>
  )
}
