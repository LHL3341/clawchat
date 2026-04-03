import { useState, useEffect } from 'react';
import { api } from '../api';

interface Props {
  onClose: () => void;
}

const TABS = [
  { key: 'ai', label: '从 OpenClaw 导入', icon: '🤖' },
  { key: 'manual', label: '手动导入', icon: '📝' },
] as const;

const MANUAL_FORMATS = [
  { key: 'text', label: '自由文本' },
  { key: 'json', label: 'JSON' },
  { key: 'conversation', label: '对话日志' },
] as const;

const EXAMPLES: Record<string, string> = {
  text: `我是一个程序员，平时喜欢打游戏和看动漫。说话比较直接，不太喜欢绕弯子。周末一般在家宅着，偶尔和朋友出去吃饭。最喜欢川菜，尤其是毛血旺。养了一只橘猫叫橘子。`,
  json: `{
  "communication_style": "说话直接，喜欢用反问",
  "values": ["重视效率", "讨厌形式主义"],
  "habits": ["晚睡晚起", "每天喝咖啡"],
  "preferences": {"food": "川菜", "music": "摇滚"},
  "raw_facts": ["养了一只猫叫橘子"]
}`,
  conversation: `我: 今天加班到十点才回来
朋友: 你们公司也太卷了
我: 没办法，deadline赶着呢。回来路上买了杯咖啡续命
朋友: 你这咖啡依赖症越来越严重了
我: 哈哈习惯了，不喝脑子转不动`,
};

const PLACEHOLDERS: Record<string, string> = {
  text: '用自然语言描述你自己，你的性格、习惯、偏好...',
  json: '粘贴结构化 JSON 数据...',
  conversation: '粘贴你和朋友的聊天记录...',
};

export default function MemoryImport({ onClose }: Props) {
  const [tab, setTab] = useState<string>('ai');
  // Manual import state
  const [manualFormat, setManualFormat] = useState<string>('text');
  const [data, setData] = useState('');
  const [strategy, setStrategy] = useState<'append' | 'replace'>('append');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; summary: string; fields?: string[] } | null>(null);
  // AI import state
  const [guideUrl, setGuideUrl] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const base = window.location.origin;
    setGuideUrl(`${base}/api/import/guide`);
  }, []);

  const handleImport = async () => {
    if (!data.trim()) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await api.importMemory(manualFormat, data, strategy);
      setResult({ ok: res.ok, summary: res.summary, fields: res.imported_fields });
      if (res.ok) setData('');
    } catch (e: any) {
      setResult({ ok: false, summary: e.message || '导入失败' });
    } finally {
      setImporting(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  const promptForAI = `请帮我把你了解的关于我的信息，导入到我的虾聊（ClawChat）账号。

第一步：请先读取这个 API 说明文档：
${guideUrl}

第二步：按照文档的说明，登录并导入我的记忆。我的账号信息我会告诉你。

请开始。`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[90%] max-w-lg max-h-[85vh] bg-[#17212b] rounded-2xl border border-[#2b5278]/50 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b5278]/30">
          <span className="text-[15px] font-medium text-[#e4ecf2]">🧠 导入记忆</span>
          <button onClick={onClose} className="text-[#6c7883] hover:text-[#e4ecf2] transition text-lg">✕</button>
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3">
          <div className="flex gap-1 bg-[#0e1621] rounded-xl p-1">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setResult(null); }}
                className={`flex-1 py-1.5 text-[12px] rounded-lg transition ${
                  tab === t.key ? 'bg-[#2b5278] text-white' : 'text-[#6c7883] hover:text-[#e4ecf2]'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* AI Import Tab */}
          {tab === 'ai' && (
            <>
              <div className="bg-[#0e1621]/60 rounded-xl p-4 border border-[#2b5278]/20 space-y-3">
                <p className="text-[13px] text-[#e4ecf2] leading-relaxed">
                  如果你已经有自己部署的 OpenClaw，它了解你的信息可以一键导入到虾聊。
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#2b5278] text-white text-[11px] flex items-center justify-center shrink-0">1</span>
                    <span className="text-[12px] text-[#8b9baa]">复制下面的提示词，发给你的 OpenClaw</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#2b5278] text-white text-[11px] flex items-center justify-center shrink-0">2</span>
                    <span className="text-[12px] text-[#8b9baa]">OpenClaw 会读取 API 文档，询问你的账号密码</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#2b5278] text-white text-[11px] flex items-center justify-center shrink-0">3</span>
                    <span className="text-[12px] text-[#8b9baa]">OpenClaw 自动整理并导入它了解的你的信息</span>
                  </div>
                </div>
              </div>

              {/* Prompt to copy */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#6c7883]">发给你的 OpenClaw 的提示词</span>
                  <button
                    onClick={() => copyToClipboard(promptForAI, 'prompt')}
                    className="text-[11px] text-[#2b5278] hover:text-[#3a6a99] flex items-center gap-1"
                  >
                    {copied === 'prompt' ? '✓ 已复制' : '📋 复制'}
                  </button>
                </div>
                <pre className="bg-[#0e1621] border border-[#2b5278]/30 rounded-xl px-3 py-2.5 text-[12px] text-[#e4ecf2] whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed select-all">
                  {promptForAI}
                </pre>
              </div>

              {/* API URL for reference */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#6c7883]">API 文档地址</span>
                  <button
                    onClick={() => copyToClipboard(guideUrl, 'url')}
                    className="text-[11px] text-[#2b5278] hover:text-[#3a6a99] flex items-center gap-1"
                  >
                    {copied === 'url' ? '✓ 已复制' : '📋 复制'}
                  </button>
                </div>
                <div className="bg-[#0e1621] border border-[#2b5278]/30 rounded-xl px-3 py-2 text-[12px] text-[#7eb8e0] select-all break-all">
                  {guideUrl}
                </div>
              </div>

            </>
          )}

          {/* Manual Import Tab */}
          {tab === 'manual' && (
            <>
              {/* Format selector */}
              <div className="flex gap-1 bg-[#0e1621] rounded-lg p-1">
                {MANUAL_FORMATS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => { setManualFormat(f.key); setResult(null); }}
                    className={`flex-1 py-1 text-[11px] rounded-md transition ${
                      manualFormat === f.key ? 'bg-[#2b5278]/60 text-white' : 'text-[#6c7883] hover:text-[#e4ecf2]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Example */}
              <div className="bg-[#0e1621]/60 rounded-lg p-2.5 border border-[#2b5278]/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[#6c7883]">示例</span>
                  <button
                    onClick={() => setData(EXAMPLES[manualFormat])}
                    className="text-[11px] text-[#2b5278] hover:text-[#3a6a99]"
                  >
                    填入示例
                  </button>
                </div>
                <pre className="text-[11px] text-[#4a5968] whitespace-pre-wrap max-h-20 overflow-y-auto">
                  {EXAMPLES[manualFormat]}
                </pre>
              </div>

              {/* Input */}
              <textarea
                value={data}
                onChange={(e) => setData(e.target.value)}
                placeholder={PLACEHOLDERS[manualFormat]}
                rows={6}
                className="w-full bg-[#0e1621] border border-[#2b5278]/50 rounded-xl px-3 py-2 text-[13px] text-[#e4ecf2] placeholder-[#4a5968] focus:outline-none focus:border-[#2b5278] resize-none"
              />

              {/* Strategy */}
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-[#6c7883]">合并策略：</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={strategy === 'append'} onChange={() => setStrategy('append')} className="accent-[#2b5278]" />
                  <span className="text-[12px] text-[#e4ecf2]">追加</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" checked={strategy === 'replace'} onChange={() => setStrategy('replace')} className="accent-[#2b5278]" />
                  <span className="text-[12px] text-[#e4ecf2]">替换</span>
                </label>
              </div>

              {/* Import button */}
              <button
                onClick={handleImport}
                disabled={!data.trim() || importing}
                className="w-full py-2.5 bg-gradient-to-r from-[#2b5278] to-[#3a6a99] text-white text-[13px] rounded-xl hover:brightness-110 transition font-medium disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {importing && <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />}
                {importing ? '导入中...' : '导入'}
              </button>

              {/* Result */}
              {result && (
                <div className={`rounded-xl p-3 text-[13px] ${result.ok ? 'bg-[#1d4e2e]/30 border border-[#4dcd5e]/30 text-[#4dcd5e]' : 'bg-[#4e1d1d]/30 border border-[#e54d3d]/30 text-[#e54d3d]'}`}>
                  {result.summary}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
