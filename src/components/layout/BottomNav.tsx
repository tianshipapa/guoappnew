import React from 'react';
import { Compass, Bookmark, Tv, Settings } from 'lucide-react';

interface BottomNavProps {
  activeView: string;
  onSelectView: (view: string) => void;
  favoritesCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeView,
  onSelectView,
  favoritesCount,
}) => {
  // 播放历史已并入收藏夹；自定义源 / 源显示收进设置，底栏只留四个主入口
  const tabs = [
    { id: 'explore', label: '发现', icon: Compass },
    { id: 'library', label: '收藏夹', icon: Bookmark, badge: favoritesCount > 0 ? favoritesCount : null },
    { id: 'live', label: '直播', icon: Tv },
    { id: 'settings', label: '设置', icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#101422]/95 backdrop-blur border-t border-slate-800 lg:hidden px-2 py-1 flex items-center justify-around shadow-2xl">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeView === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectView(tab.id)}
            className={`flex flex-col items-center justify-center py-1 px-3 relative transition-colors ${
              isActive ? 'text-rose-500 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="relative">
              <Icon className={`w-5 h-5 ${isActive ? 'scale-110' : ''} transition-transform`} />
              {tab.badge ? (
                <span className="absolute -top-1 -right-2.5 px-1 min-w-[14px] h-3.5 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              ) : null}
            </div>
            <span className="text-[11px] mt-0.5">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
