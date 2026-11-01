import React, { useEffect, useState } from 'react';
import { Plug, Loader2, AlertCircle } from 'lucide-react';
import { isCoreOnline, DEFAULT_CORE_BASE } from '../../services/nativeCore';

interface CoreStatusPillProps {
  /** 点击后跳到自定义源面板，可在那里改服务地址。 */
  onClick?: () => void;
}

/**
 * 本机抓取服务状态灯。
 *
 * 页面可能部署在 Cloudflare Pages（没有后端），所有抓取都得回到本机服务；
 * 一旦没连上，全站会看起来「什么也搜不到」，所以这里常驻一个明确提示，
 * 而不是让用户对着空列表猜。
 */
export const CoreStatusPill: React.FC<CoreStatusPillProps> = ({ onClick }) => {
  const [online, setOnline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async (force = false) => {
    setChecking(true);
    const ok = await isCoreOnline(force);
    setOnline(ok);
    setChecking(false);
  };

  useEffect(() => {
    let alive = true;
    void isCoreOnline().then((ok) => {
      if (alive) setOnline(ok);
    });
    const timer = window.setInterval(() => {
      void isCoreOnline().then((ok) => {
        if (alive) setOnline(ok);
      });
    }, 20000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // 连上了就不打扰
  if (online === null || online) return null;

  return (
    <button
      onClick={() => {
        void check(true);
        onClick?.();
      }}
      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-medium hover:bg-amber-500/25 transition-colors shrink-0"
      title="未连接抓取服务：云端部署请确认 Functions（api/ 或 functions/ 目录）已随前端发布，本地请运行 npm run serve；点此可修改地址"
    >
      {checking ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <AlertCircle className="w-3 h-3" />
      )}
      <span className="hidden sm:inline">本机服务未连接</span>
      <Plug className="w-3 h-3 sm:hidden" />
    </button>
  );
};
