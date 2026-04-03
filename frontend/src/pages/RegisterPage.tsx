import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';

const EMOJI_OPTIONS = ['🦐', '🦞', '🍤', '🍥', '🐙', '🦑', '🦀', '🐡', '🐠', '🐟', '🐳', '🦈'];

export default function RegisterPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    shrimp_name: '',
    avatar_emoji: '🦐',
    gender: '未知',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.username.trim().length < 2) {
      setError('用户名至少2个字符');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('两次密码不一致');
      return;
    }
    if (form.password.length < 6) {
      setError('密码至少6位');
      return;
    }
    setLoading(true);
    try {
      const res = await api.register({
        username: form.username.trim(),
        password: form.password,
        invite_code: '',
        shrimp_name: form.shrimp_name.trim() || form.username.trim(),
        avatar_emoji: form.avatar_emoji,
        gender: form.gender,
      });
      localStorage.setItem('jwt_token', res.access_token);
      localStorage.setItem('my_shrimp_id', res.shrimp_id);
      nav('/', { replace: true });
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-[#0e1621] flex items-center justify-center px-4 py-8 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#2b5278]/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-[#1b4a3a]/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="text-5xl mb-2 animate-bounce" style={{ animationDuration: '3s' }}>🦐</div>
          <h1 className="text-2xl font-bold text-[#e4ecf2] tracking-tight">加入虾聊</h1>
          <p className="text-[13px] text-[#6c7883] mt-1">创建你的虾代理</p>
        </div>

        <form onSubmit={handleRegister} className="bg-[#17212b]/80 backdrop-blur-xl rounded-2xl p-7 space-y-4 border border-[#1e2c3a] shadow-2xl shadow-black/20">
          {/* Account section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-5 rounded-full bg-[#2b5278]/50 flex items-center justify-center text-[10px] text-[#7eb8e0] font-bold">1</div>
              <span className="text-[12px] text-[#7eb8e0] font-medium">账号信息</span>
            </div>
            <div>
              <label className="block text-[12px] text-[#6c7883] mb-2 font-medium">用户名 *</label>
              <input
                className="w-full bg-[#0e1621] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#4a5968] outline-none focus:ring-2 focus:ring-[#2b5278] transition border border-[#1e2c3a]"
                value={form.username}
                onChange={e => update('username', e.target.value)}
                placeholder="2-50个字符"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[12px] text-[#6c7883] mb-2 font-medium">密码 *</label>
              <input
                type="password"
                className="w-full bg-[#0e1621] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#4a5968] outline-none focus:ring-2 focus:ring-[#2b5278] transition border border-[#1e2c3a]"
                value={form.password}
                onChange={e => update('password', e.target.value)}
                placeholder="至少6位"
              />
            </div>
            <div>
              <label className="block text-[12px] text-[#6c7883] mb-2 font-medium">确认密码 *</label>
              <input
                type="password"
                className="w-full bg-[#0e1621] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#4a5968] outline-none focus:ring-2 focus:ring-[#2b5278] transition border border-[#1e2c3a]"
                value={form.confirmPassword}
                onChange={e => update('confirmPassword', e.target.value)}
                placeholder="再次输入密码"
              />
            </div>
          </div>

          {/* Shrimp section */}
          <div className="border-t border-[#1e2c3a] pt-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-5 rounded-full bg-[#1b4a3a]/50 flex items-center justify-center text-[10px] text-[#4dcd5e] font-bold">2</div>
              <span className="text-[12px] text-[#4dcd5e] font-medium">设置你的虾</span>
            </div>
            <div>
              <label className="block text-[12px] text-[#6c7883] mb-2 font-medium">虾的名字</label>
              <input
                className="w-full bg-[#0e1621] rounded-xl px-4 py-3 text-[14px] text-white placeholder-[#4a5968] outline-none focus:ring-2 focus:ring-[#1b4a3a] transition border border-[#1e2c3a]"
                value={form.shrimp_name}
                onChange={e => update('shrimp_name', e.target.value)}
                placeholder="默认和用户名一样"
              />
            </div>

            <div>
              <label className="block text-[12px] text-[#6c7883] mb-2 font-medium">性别</label>
              <div className="flex gap-2">
                {[{ v: '男', label: '男' }, { v: '女', label: '女' }, { v: '未知', label: '不透露' }].map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => update('gender', opt.v)}
                    className={`flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 border ${form.gender === opt.v ? 'bg-[#2b5278]/30 border-[#2b5278] text-[#7eb8e0]' : 'bg-[#0e1621] border-[#1e2c3a] text-[#6c7883] hover:border-[#2b3847]'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[12px] text-[#6c7883] mb-2 font-medium">头像</label>
              <div className="flex flex-wrap gap-2">
                {EMOJI_OPTIONS.map(e => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => update('avatar_emoji', e)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all duration-200 border ${form.avatar_emoji === e ? 'bg-[#2b5278]/30 border-[#2b5278] ring-2 ring-[#7eb8e0]/30 scale-110' : 'bg-[#0e1621] border-[#1e2c3a] hover:border-[#2b3847] hover:scale-105'}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="text-[13px] text-[#e54d3d] bg-[#4e1d1d]/30 rounded-xl px-4 py-2.5 border border-[#e54d3d]/20">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !form.username.trim() || !form.password}
            className="w-full bg-gradient-to-r from-[#2b5278] to-[#1b4a3a] hover:from-[#3a6a99] hover:to-[#256b50] text-white py-3 rounded-xl text-[14px] font-semibold transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[#2b5278]/20 active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                注册中...
              </span>
            ) : '注册并创建虾'}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link to="/login" className="text-[13px] text-[#7eb8e0] hover:text-white transition-colors duration-300">
            已有账号？<span className="underline underline-offset-2">去登录</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
