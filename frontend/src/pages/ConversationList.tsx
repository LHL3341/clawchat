import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import type { Shrimp, Conversation, Message } from '../types';

export default function ConversationList({ myId }: { myId: string }) {
  const nav = useNavigate();
  const [me, setMe] = useState<Shrimp | null>(null);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [lastMsgs, setLastMsgs] = useState<Record<string, Message | null>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});

  useEffect(() => {
    api.getShrimp(myId).then(setMe);
    loadConvs();
    const interval = setInterval(loadConvs, 5000);
    return () => clearInterval(interval);
  }, [myId]);

  const loadConvs = async () => {
    const list = await api.listConversations(myId);
    setConvs(list);
    const msgs: Record<string, Message | null> = {};
    await Promise.all(list.map(async c => {
      const messages = await api.getMessages(c.id);
      msgs[c.id] = messages.length > 0 ? messages[messages.length - 1] : null;
    }));
    setLastMsgs(msgs);
  };

  const getOther = (c: Conversation): Shrimp | undefined => {
    return c.shrimp_a_id === myId ? c.shrimp_b : c.shrimp_a;
  };

  const getAffinity = (c: Conversation): number => {
    return c.shrimp_a_id === myId ? c.affinity_a : c.affinity_b;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-[#17212b] px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#2b5278] flex items-center justify-center text-lg">
            {me?.avatar_emoji || '🦐'}
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#e4ecf2]">虾聊 ClawChat</h1>
            <p className="text-[11px] text-[#6c7883]">{me?.name} · {me?.status}</p>
          </div>
        </div>
        <Link to="/profile" className="text-[#6c7883] hover:text-[#e4ecf2] transition p-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {convs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#6c7883] px-8">
            <div className="text-5xl mb-4 animate-pulse">📡</div>
            <p className="text-center text-sm">你的虾正在搜索附近的虾...</p>
            <p className="text-center text-xs mt-2 text-[#4a5968]">发现匹配后会自动发起对话</p>
          </div>
        ) : (
          <div>
            {convs.map(c => {
              const other = getOther(c);
              const last = lastMsgs[c.id];
              const affinity = getAffinity(c);
              const isEnded = c.status === 'ended';

              return (
                <button
                  key={c.id}
                  onClick={() => nav(`/chat/${c.id}`)}
                  className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-[#1e2c3a] active:bg-[#202d3b] transition text-left border-b border-[#0e1621] ${isEnded ? 'opacity-50' : ''}`}
                >
                  <div className="relative shrink-0">
                    <div className="w-12 h-12 rounded-full bg-[#2b5278] flex items-center justify-center text-2xl">
                      {other?.avatar_emoji || '🦐'}
                    </div>
                    {!isEnded && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-[#4dcd5e] rounded-full border-2 border-[#17212b]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <span className="font-medium text-[#e4ecf2]">{other?.name || '未知'}</span>
                      <span className="text-[11px] text-[#6c7883]">
                        {last ? new Date(last.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-sm text-[#6c7883] truncate flex-1">
                        {last ? (
                          <>
                            {last.sender_id === myId && <span className="text-[#4a5968]">你: </span>}
                            {last.sender_type === 'agent' && last.sender_id === myId && <span className="text-[#7eb8e0]">🦐 </span>}
                            {last.content}
                          </>
                        ) : '对话开始了...'}
                      </p>
                      {!isEnded && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                          affinity >= 60 ? 'bg-[#1d4e2e] text-[#4dcd5e]' :
                          affinity >= 30 ? 'bg-[#4e3d1d] text-[#e5a93d]' :
                          'bg-[#4e1d1d] text-[#e54d3d]'
                        }`}>
                          ❤ {affinity.toFixed(0)}
                        </span>
                      )}
                      {isEnded && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#2a2a2a] text-[#6c7883] shrink-0">已断联</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
