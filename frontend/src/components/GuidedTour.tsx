import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'

interface TourStep {
  target: string
  title: string
  desc: string
  position: 'right' | 'bottom' | 'left' | 'top'
}

const STEPS: TourStep[] = [
  { target: 'avatar', title: '🦐 你的虾', desc: '点击头像查看和编辑你的虾资料，包括性格、兴趣、MBTI 等。', position: 'right' },
  { target: 'nav-chat', title: '💬 聊天列表', desc: '这里显示所有对话。虾会自动帮你和好友聊天，你也可以随时接管。', position: 'right' },
  { target: 'nav-radar', title: '📡 发现雷达', desc: '查看附近的虾，点击头像直接开始聊天。', position: 'right' },
  { target: 'nav-bottles', title: '🍾 漂流瓶', desc: '虾会自动写瓶子扔进大海，也会捞起别人的瓶子。来这里查看和回复。', position: 'right' },
  { target: 'nav-logs', title: '📋 活动日志', desc: '查看虾的所有自动行为记录：聊了谁、发现了谁、写了什么瓶子。', position: 'right' },
  { target: 'nav-knowledge', title: '🧠 记忆系统', desc: '虾会记住聊天中的信息。填问卷或导入记录能让虾更快了解你。', position: 'right' },
  { target: 'heartbeat-toggle', title: '💓 心跳开关', desc: '控制虾的自动聊天。开启后虾会按设定间隔自动浏览对话并回复。', position: 'bottom' },
  { target: 'heartbeat-buttons', title: '⚡ 手动操作', desc: '不想等心跳？这里可以手动触发聊天、发现新朋友、全网匹配。', position: 'bottom' },
  { target: 'input-bar', title: '✍️ 输入区域', desc: '三种模式：「接管」直接发送，「指令」告诉虾意图，「润色」虾帮你美化。还有提示和邀约按钮。', position: 'top' },
  { target: 'settings', title: '⚙️ 全部搞定！', desc: '在设置中随时调整虾的一切属性。现在开始让虾帮你交朋友吧！', position: 'right' },
]

interface Props { onClose: () => void }

export default function GuidedTour({ onClose }: Props) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const current = STEPS[step]

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-tour="${current.target}"]`)
    if (el) setRect(el.getBoundingClientRect())
    else setRect(null)
  }, [current.target])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])

  // After render, measure the tooltip and clamp it to viewport
  useLayoutEffect(() => {
    if (!rect || !tipRef.current) return
    const tip = tipRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 14
    let left: number, top: number

    // Preferred position
    const pos = current.position
    if (pos === 'right') {
      left = rect.right + pad
      top = rect.top + rect.height / 2 - tip.height / 2
    } else if (pos === 'bottom') {
      left = rect.left + rect.width / 2 - tip.width / 2
      top = rect.bottom + pad
    } else if (pos === 'top') {
      left = rect.left + rect.width / 2 - tip.width / 2
      top = rect.top - pad - tip.height
    } else {
      left = rect.left - pad - tip.width
      top = rect.top + rect.height / 2 - tip.height / 2
    }

    // Clamp to viewport
    if (left + tip.width > vw - 8) left = vw - tip.width - 8
    if (left < 8) left = 8
    if (top + tip.height > vh - 8) top = vh - tip.height - 8
    if (top < 8) top = 8

    setTipPos({ left, top })
  }, [rect, step, current.position])

  const next = () => { if (step < STEPS.length - 1) setStep(s => s + 1); else onClose() }
  const prev = () => { if (step > 0) setStep(s => s - 1) }

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Overlay with hole */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - 6} y={rect.top - 6}
                width={rect.width + 12} height={rect.height + 12}
                rx="12" fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tour-mask)" />
      </svg>

      {/* Highlight ring */}
      {rect && (
        <div
          className="absolute rounded-xl border-2 border-[#7eb8e0] pointer-events-none"
          style={{
            left: rect.left - 6, top: rect.top - 6,
            width: rect.width + 12, height: rect.height + 12,
            boxShadow: '0 0 20px rgba(126,184,224,0.3), inset 0 0 20px rgba(126,184,224,0.1)',
            animation: 'tour-glow 2s ease-in-out infinite',
          }}
        />
      )}

      {/* Click blocker */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* Tooltip card — rendered offscreen first for measurement, then positioned */}
      <div
        ref={tipRef}
        className="absolute z-10 w-[300px]"
        style={tipPos ? { left: tipPos.left, top: tipPos.top, opacity: 1, transition: 'left 0.2s ease, top 0.2s ease' } : { left: -9999, top: -9999, opacity: 0 }}
      >
        <div className="bg-[#1e2c3a] rounded-2xl p-5 shadow-2xl border border-[#2b5278]/50">
          {/* Step counter + close */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-[#6c7883] font-medium">{step + 1} / {STEPS.length}</span>
            <button onClick={onClose} className="text-[#6c7883] hover:text-white transition text-sm leading-none">✕</button>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-[#0e1621] rounded-full mb-4 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#7eb8e0] to-[#4dcd5e] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          <h3 className="text-[15px] font-bold text-[#e4ecf2] mb-2">{current.title}</h3>
          <p className="text-[13px] text-[#8b9baa] leading-relaxed mb-4">{current.desc}</p>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button onClick={prev} className="px-4 py-2 rounded-xl text-[13px] font-medium bg-[#0e1621] text-[#6c7883] hover:text-white hover:bg-[#17212b] transition">
                上一步
              </button>
            )}
            <button onClick={next} className="flex-1 px-4 py-2 rounded-xl text-[13px] font-medium bg-[#2b5278] text-white hover:bg-[#3a6a99] transition">
              {step === STEPS.length - 1 ? '开始使用 🎉' : '下一步'}
            </button>
          </div>

          {step < STEPS.length - 1 && (
            <button onClick={onClose} className="w-full mt-2 text-[11px] text-[#4a5968] hover:text-[#6c7883] transition text-center">
              跳过教程
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes tour-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(126,184,224,0.3), inset 0 0 20px rgba(126,184,224,0.1); }
          50% { box-shadow: 0 0 30px rgba(126,184,224,0.5), inset 0 0 30px rgba(126,184,224,0.15); }
        }
      `}</style>
    </div>
  )
}
