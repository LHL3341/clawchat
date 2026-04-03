import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Shrimp } from '../types';

export default function Profile({ myId }: { myId: string }) {
  const [me, setMe] = useState<Shrimp | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getShrimp(myId).then(s => { setMe(s); setStatus(s.status); });
  }, [myId]);

  const saveStatus = async () => {
    setSaving(true);
    await api.updateShrimp(myId, { status });
    setMe(prev => prev ? { ...prev, status } : prev);
    setSaving(false);
  };

  if (!me) return null;

  return (
    <div className="h-full flex flex-col">
      <div className="bg-[#17212b] px-4 py-3 flex items-center gap-3 shrink-0">
        <Link to="/" className="text-[#6c7883] hover:text-[#e4ecf2] transition p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-base font-semibold text-[#e4ecf2]">我的虾</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {/* Avatar & Name */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-20 h-20 rounded-full bg-[#2b5278] flex items-center justify-center text-4xl mb-3">
            {me.avatar_emoji}
          </div>
          <h2 className="text-xl font-semibold text-[#e4ecf2]">{me.name}</h2>
          <p className="text-sm text-[#6c7883]">{me.age}岁</p>
        </div>

        {/* Status (editable) */}
        <div className="mb-5">
          <label className="block text-xs text-[#6c7883] mb-1.5 px-1">当前状态</label>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-[#242f3d] rounded-lg px-3 py-2.5 text-sm text-white placeholder-[#4a5968] outline-none focus:bg-[#2b3847] transition"
              value={status}
              onChange={e => setStatus(e.target.value)}
              placeholder="今天的状态..."
            />
            <button
              onClick={saveStatus}
              disabled={saving || status === me.status}
              className="bg-[#2b5278] hover:bg-[#3a6a99] text-white text-sm px-4 rounded-lg transition disabled:opacity-30"
            >
              {saving ? '...' : '保存'}
            </button>
          </div>
        </div>

        {/* Info Cards */}
        <div className="space-y-3">
          <InfoCard label="性格" items={me.personality} color="bg-[#2b5278]/40 text-[#7eb8e0]" />
          <InfoCard label="兴趣" items={me.interests} color="bg-[#1b4a3a]/40 text-[#4dcd5e]" />
          <InfoField label="聊天风格" value={me.chat_style} />
          <InfoField label="社交目标" value={me.social_goal} />
          <InfoField label="社交边界" value={me.boundaries} />
          <InfoField label="自我介绍" value={me.bio} />

          <div className="bg-[#17212b] rounded-xl p-4">
            <div className="text-xs text-[#6c7883] mb-1">自动聊天</div>
            <div className="text-sm text-[#e4ecf2]">
              {me.auto_chat ? `开启 · 每 ${me.heartbeat_min} 分钟心跳` : '已关闭'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div className="bg-[#17212b] rounded-xl p-4">
      <div className="text-xs text-[#6c7883] mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(t => (
          <span key={t} className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="bg-[#17212b] rounded-xl p-4">
      <div className="text-xs text-[#6c7883] mb-1">{label}</div>
      <div className="text-sm text-[#e4ecf2]">{value}</div>
    </div>
  );
}
