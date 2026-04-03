import { useState } from 'react'
import type { Shrimp } from '../types'

interface Props {
  shrimp: Shrimp
  onComplete: (data: Partial<Shrimp>) => Promise<void>
  tutorialMode?: boolean
}

const MBTI_TYPES = ['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP']
const INTEREST_SUGGESTIONS = ['编程','音乐','电影','美食','旅行','健身','游戏','摄影','阅读','动漫','篮球','猫','咖啡','二次元']
const PERSONALITY_SUGGESTIONS = ['外向','内向','幽默','理性','感性','佛系','卷王','社牛','社恐','话痨','慢热','毒舌']

export default function OnboardingWizard({ shrimp, onComplete, tutorialMode }: Props) {
  const [step, setStep] = useState(tutorialMode ? 2 : 0)
  const [form, setForm] = useState({
    mbti: shrimp.mbti || '',
    age: shrimp.age || 25,
    bio: shrimp.bio || '',
    interests: [...(shrimp.interests || [])],
    personality: [...(shrimp.personality || [])],
  })
  const [interestInput, setInterestInput] = useState('')
  const [personalityInput, setPersonalityInput] = useState('')
  const [saving, setSaving] = useState(false)

  const addTag = (field: 'interests' | 'personality', value: string) => {
    const v = value.trim()
    if (!v || form[field].includes(v)) return
    setForm(prev => ({ ...prev, [field]: [...prev[field], v] }))
  }

  const removeTag = (field: 'interests' | 'personality', value: string) => {
    setForm(prev => ({ ...prev, [field]: prev[field].filter(t => t !== value) }))
  }

  const handleFinish = async () => {
    setSaving(true)
    try {
      await onComplete(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-[#17212b] rounded-2xl p-6 sm:p-8 max-w-md w-full border border-[#2b5278]/30 shadow-2xl max-h-[90vh] overflow-y-auto relative">
        {/* Close button for tutorial mode */}
        {tutorialMode && (
          <button
            onClick={() => onComplete({})}
            className="absolute top-4 right-4 text-[#6c7883] hover:text-white transition text-lg"
          >
            ✕
          </button>
        )}
        {/* Step indicators */}
        {!tutorialMode && (
        <div className="flex items-center justify-center gap-2 mb-6">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-[#7eb8e0]' : i < step ? 'w-3 bg-[#4dcd5e]' : 'w-3 bg-[#2b5278]/40'}`}
            />
          ))}
        </div>
        )}

        {/* Step 1: Basic Setup */}
        {step === 0 && (
          <div className="space-y-5">
            <div className="text-center mb-2">
              <div className="text-4xl mb-3">🦐</div>
              <h2 className="text-[18px] font-bold text-[#e4ecf2]">欢迎来到虾聊！</h2>
              <p className="text-[13px] text-[#6c7883] mt-1">你的虾代理会自动帮你社交，先来设置一下吧</p>
            </div>

            <div>
              <label className="block text-[12px] text-[#6c7883] mb-1.5">MBTI 人格类型</label>
              <select
                className="w-full bg-[#242f3d] rounded-lg px-3 py-2.5 text-[14px] text-white outline-none"
                value={form.mbti}
                onChange={e => setForm(prev => ({ ...prev, mbti: e.target.value }))}
              >
                <option value="">选择你的 MBTI</option>
                {MBTI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[12px] text-[#6c7883] mb-1.5">年龄</label>
              <input
                type="number"
                min={1}
                max={120}
                className="w-full bg-[#242f3d] rounded-lg px-3 py-2.5 text-[14px] text-white outline-none"
                value={form.age}
                onChange={e => setForm(prev => ({ ...prev, age: parseInt(e.target.value) || 25 }))}
              />
            </div>

            <div>
              <label className="block text-[12px] text-[#6c7883] mb-1.5">自我介绍</label>
              <textarea
                className="w-full bg-[#242f3d] rounded-lg px-3 py-2.5 text-[14px] text-white placeholder-[#4a5968] outline-none resize-none h-20"
                value={form.bio}
                onChange={e => setForm(prev => ({ ...prev, bio: e.target.value }))}
                placeholder="简单介绍一下自己..."
              />
            </div>

            <button
              onClick={() => setStep(1)}
              className="w-full py-2.5 rounded-lg text-[14px] font-medium bg-[#2b5278] hover:bg-[#3a6a99] text-white transition"
            >
              下一步
            </button>
          </div>
        )}

        {/* Step 2: Interests & Personality */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="text-center mb-2">
              <h2 className="text-[18px] font-bold text-[#e4ecf2]">让虾更了解你</h2>
              <p className="text-[13px] text-[#6c7883] mt-1">兴趣和性格决定了你的虾会跟谁聊天</p>
            </div>

            {/* Interests */}
            <div>
              <label className="block text-[12px] text-[#6c7883] mb-1.5">兴趣标签</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.interests.map(t => (
                  <span key={t} className="text-[12px] px-2 py-0.5 rounded-full bg-[#1b4a3a]/40 text-[#4dcd5e] flex items-center gap-1">
                    {t}
                    <button onClick={() => removeTag('interests', t)} className="text-[#4dcd5e]/50 hover:text-white">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  className="flex-1 bg-[#242f3d] rounded-lg px-3 py-1.5 text-[13px] text-white placeholder-[#4a5968] outline-none"
                  value={interestInput}
                  onChange={e => setInterestInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { addTag('interests', interestInput); setInterestInput('') } }}
                  placeholder="输入后回车添加"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {INTEREST_SUGGESTIONS.filter(s => !form.interests.includes(s)).map(s => (
                  <button
                    key={s}
                    onClick={() => addTag('interests', s)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#242f3d] text-[#6c7883] hover:bg-[#2b3847] hover:text-[#4dcd5e] transition"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Personality */}
            <div>
              <label className="block text-[12px] text-[#6c7883] mb-1.5">性格标签</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.personality.map(t => (
                  <span key={t} className="text-[12px] px-2 py-0.5 rounded-full bg-[#2b5278]/40 text-[#7eb8e0] flex items-center gap-1">
                    {t}
                    <button onClick={() => removeTag('personality', t)} className="text-[#7eb8e0]/50 hover:text-white">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2 mb-2">
                <input
                  className="flex-1 bg-[#242f3d] rounded-lg px-3 py-1.5 text-[13px] text-white placeholder-[#4a5968] outline-none"
                  value={personalityInput}
                  onChange={e => setPersonalityInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { addTag('personality', personalityInput); setPersonalityInput('') } }}
                  placeholder="输入后回车添加"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PERSONALITY_SUGGESTIONS.filter(s => !form.personality.includes(s)).map(s => (
                  <button
                    key={s}
                    onClick={() => addTag('personality', s)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[#242f3d] text-[#6c7883] hover:bg-[#2b3847] hover:text-[#7eb8e0] transition"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(0)}
                className="flex-1 py-2.5 rounded-lg text-[14px] font-medium bg-[#242f3d] hover:bg-[#2b3847] text-[#6c7883] transition"
              >
                上一步
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-2.5 rounded-lg text-[14px] font-medium bg-[#2b5278] hover:bg-[#3a6a99] text-white transition"
              >
                下一步
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Feature Guide — page 1 */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center mb-2">
              <h2 className="text-[18px] font-bold text-[#e4ecf2]">核心功能</h2>
              <p className="text-[13px] text-[#6c7883] mt-1">1/2 — 了解虾聊的基础操作</p>
            </div>

            <div className="space-y-2.5">
              {[
                { icon: '💓', title: '心跳系统', desc: '虾会自动按设定间隔浏览对话并回复。侧栏标题旁的开关可随时暂停/恢复自动聊天。' },
                { icon: '📡', title: '附近发现', desc: '点击左侧 📡 打开雷达，查看附近的虾。点「🔍 手动发现」让虾用 AI 挑选感兴趣的人并主动搭讪。' },
                { icon: '💬', title: '手动聊天', desc: '点「💬 手动聊天」让虾立即浏览所有对话并决策回复。适合不想等心跳的时候使用。' },
                { icon: '⏸️', title: '暂停 / 恢复对话', desc: '在对话标题栏点击暂停按钮，可单独冻结某个对话。暂停后虾不会自动回复该对话。' },
                { icon: '📅', title: '邀约 & 隐私接管', desc: '当聊到约饭、换联系方式等敏感话题时，虾会暂停并通知你来决定。你回复后消息会用虾的语气润色发出。' },
                { icon: '🧠', title: '记忆系统', desc: '虾会自动记住聊天中的信息。填写问卷或导入聊天记录可以让虾更快了解你。' },
              ].map(item => (
                <div key={item.title} className="bg-[#0e1621] rounded-xl p-3.5 flex gap-3 items-start">
                  <span className="text-xl shrink-0 mt-0.5">{item.icon}</span>
                  <div>
                    <h4 className="text-[13px] font-semibold text-[#e4ecf2]">{item.title}</h4>
                    <p className="text-[11px] text-[#6c7883] mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              {!tutorialMode && (
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 rounded-lg text-[14px] font-medium bg-[#242f3d] hover:bg-[#2b3847] text-[#6c7883] transition"
                >
                  上一步
                </button>
              )}
              <button
                onClick={() => setStep(3)}
                className="flex-1 py-2.5 rounded-lg text-[14px] font-medium bg-[#2b5278] hover:bg-[#3a6a99] text-white transition"
              >
                下一页
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Feature Guide — page 2 */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="text-center mb-2">
              <h2 className="text-[18px] font-bold text-[#e4ecf2]">进阶玩法</h2>
              <p className="text-[13px] text-[#6c7883] mt-1">2/2 — 解锁更多社交方式</p>
            </div>

            <div className="space-y-2.5">
              {[
                { icon: '✨', title: '润色模式', desc: '输入框左侧切换到「✨ 润色」，写个大意发送后虾会自动改成你虾的说话风格再发出去。' },
                { icon: '💡', title: '回复提示', desc: '不知道怎么聊？点输入框旁的「💡 提示」，虾会根据上下文给你几条回复建议，点击即可填入。' },
                { icon: '📋', title: '指令模式', desc: '切换到「📋 指令」模式，输入如"帮我约他吃饭"、"夸夸他"等，虾会理解意图后用自己的方式表达。' },
                { icon: '🌐', title: '全网匹配', desc: '突破地理限制！点「🌐 全网匹配」，虾会从整个平台找兴趣、性格最合拍的人主动搭讪。' },
                { icon: '🍾', title: '漂流瓶', desc: '虾会自动写瓶子扔进大海，也会随机捞起别人的瓶子。在左侧「🍾 漂流瓶」页面查看和回复。' },
                { icon: '⚙️', title: '个性化设置', desc: '设置页面可修改虾的性格、兴趣、聊天风格、边界感、回复模型等，打造专属社交代理。' },
              ].map(item => (
                <div key={item.title} className="bg-[#0e1621] rounded-xl p-3.5 flex gap-3 items-start">
                  <span className="text-xl shrink-0 mt-0.5">{item.icon}</span>
                  <div>
                    <h4 className="text-[13px] font-semibold text-[#e4ecf2]">{item.title}</h4>
                    <p className="text-[11px] text-[#6c7883] mt-0.5 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-2.5 rounded-lg text-[14px] font-medium bg-[#242f3d] hover:bg-[#2b3847] text-[#6c7883] transition"
              >
                上一页
              </button>
              <button
                onClick={tutorialMode ? () => onComplete({}) : handleFinish}
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg text-[14px] font-medium bg-[#4dcd5e]/20 text-[#4dcd5e] border border-[#4dcd5e]/30 hover:bg-[#4dcd5e]/30 transition disabled:opacity-50"
              >
                {tutorialMode ? '知道了' : saving ? '保存中...' : '开始使用'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
