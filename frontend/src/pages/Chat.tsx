import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import type { Conversation, Message, Shrimp } from '../types';

type SendMode = 'human' | 'instruction';

export default function Chat({ myId }: { myId: string }) {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sendMode, setSendMode] = useState<SendMode>('human');
  const [loading, setLoading] = useState(false);
  const [other, setOther] = useState<Shrimp | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!conversationId) return;

    api.getMessages(conversationId).then(setMessages);

    api.listConversations(myId).then(convs => {
      const c = convs.find(c => c.id === conversationId);
      if (c) {
        setConv(c);
        const o = c.shrimp_a_id === myId ? c.shrimp_b : c.shrimp_a;
        setOther(o || null);
      }
    });

    // WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/chat/ws/${conversationId}`);
    ws.onmessage = (e) => {
      const payload = JSON.parse(e.data);
      if (payload.type === 'message') {
        setMessages(prev => {
          if (prev.some(m => m.id === payload.data.id)) return prev;
          return [...prev, payload.data];
        });
      } else if (payload.type === 'affinity_update') {
        setConv(prev => prev ? { ...prev, ...payload.data } : prev);
      }
    };

    // Poll backup
    const poll = setInterval(() => {
      api.getMessages(conversationId).then(setMessages);
    }, 8000);

    return () => { ws.close(); clearInterval(poll); };
  }, [conversationId, myId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || !conv) return;
    const content = input.trim();
    setInput('');
    setLoading(true);
    try {
      await api.sendMessage(conv.id, myId, content, sendMode === 'instruction' ? 'instruction' : 'human');
    } finally {
      setLoading(false);
    }
    inputRef.current?.focus();
  };

  const myAffinity = conv ? (conv.shrimp_a_id === myId ? conv.affinity_a : conv.affinity_b) : 50;
  const theirAffinity = conv ? (conv.shrimp_a_id === myId ? conv.affinity_b : conv.affinity_a) : 50;

  return (
    <div className="h-full flex flex-col bg-[#0e1621]">
      {/* Header */}
      <div className="bg-[#17212b] px-3 py-2.5 flex items-center gap-3 shrink-0">
        <Link to="/" className="text-[#6c7883] hover:text-[#e4ecf2] transition p-1">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="w-10 h-10 rounded-full bg-[#2b5278] flex items-center justify-center text-xl shrink-0">
          {other?.avatar_emoji || '🦐'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[#e4ecf2] text-[15px]">{other?.name || '...'}</div>
          <div className="text-xs text-[#6c7883] truncate">{other?.status}</div>
        </div>
        <div className="flex items-center gap-1 text-xs shrink-0">
          <span className="text-[#6c7883]">好感</span>
          <span className={`font-semibold ${myAffinity >= 60 ? 'text-[#4dcd5e]' : myAffinity >= 30 ? 'text-[#e5a93d]' : 'text-[#e54d3d]'}`}>
            {myAffinity.toFixed(0)}
          </span>
          <span className="text-[#3d4e5c]">/</span>
          <span className={`font-semibold ${theirAffinity >= 60 ? 'text-[#4dcd5e]' : theirAffinity >= 30 ? 'text-[#e5a93d]' : 'text-[#e54d3d]'}`}>
            {theirAffinity.toFixed(0)}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-2"
        style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, #0d1520 0%, #0e1621 100%)' }}
      >
        {messages.map((msg, i) => {
          const isMine = msg.sender_id === myId;
          const isInstruction = msg.sender_type === 'instruction';
          const showTime = i === 0 || (
            new Date(msg.created_at).getTime() - new Date(messages[i-1].created_at).getTime() > 300000
          );

          return (
            <div key={msg.id}>
              {showTime && (
                <div className="text-center my-3">
                  <span className="text-[11px] text-[#6c7883] bg-[#17212b]/80 px-2 py-0.5 rounded">
                    {new Date(msg.created_at).toLocaleString('zh-CN', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                </div>
              )}

              {isInstruction ? (
                <div className="flex justify-center my-1.5">
                  <div className="bg-[#1b2838] text-[#7eb8e0] text-xs px-3 py-1.5 rounded-lg max-w-[85%] border border-[#2b5278]/30">
                    📋 你的指令: {msg.content}
                  </div>
                </div>
              ) : (
                <div className={`flex mb-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%]`}>
                    <div
                      className={`px-3 py-2 text-[14px] leading-[1.4] ${
                        isMine
                          ? 'bg-[#2b5278] text-white rounded-[12px] rounded-br-[4px]'
                          : 'bg-[#182533] text-[#e4ecf2] rounded-[12px] rounded-bl-[4px]'
                      }`}
                    >
                      {msg.content}
                    </div>
                    <div className={`flex items-center gap-1 mt-0.5 px-1 ${isMine ? 'justify-end' : ''}`}>
                      <span className="text-[10px] text-[#4a5968]">
                        {isMine
                          ? (msg.sender_type === 'agent' ? '🦐 你的虾' : '👤 你')
                          : (msg.sender_type === 'agent' ? '🦐 对方的虾' : '👤 对方')
                        }
                      </span>
                      <span className="text-[10px] text-[#4a5968]">
                        {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-[#17212b] px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSendMode(m => m === 'human' ? 'instruction' : 'human')}
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition text-lg ${
              sendMode === 'instruction'
                ? 'bg-[#5e35b1] text-white'
                : 'bg-[#242f3d] text-[#6c7883]'
            }`}
            title={sendMode === 'instruction' ? '指令模式' : '对话模式'}
          >
            {sendMode === 'instruction' ? '📋' : '💬'}
          </button>

          <input
            ref={inputRef}
            className="flex-1 bg-[#242f3d] rounded-full px-4 py-2 text-[14px] text-white placeholder-[#6c7883] outline-none focus:bg-[#2b3847] transition"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={sendMode === 'instruction' ? '给你的虾下指令...' : '输入消息...'}
          />

          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="shrink-0 w-9 h-9 rounded-full bg-[#2b5278] hover:bg-[#3a6a99] flex items-center justify-center transition disabled:opacity-30"
          >
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
        {sendMode === 'instruction' && (
          <div className="text-[11px] text-[#5e35b1] mt-1 ml-12">
            指令模式 — 对方看不到，你的虾会参考指令来聊天
          </div>
        )}
      </div>
    </div>
  );
}
