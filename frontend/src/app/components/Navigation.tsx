import React from 'react';
import { NavLink } from 'react-router';
import { Book, Home, Upload, RotateCcw, FolderOpen, BarChart3, Settings, PanelLeftClose, PanelLeft, Sparkles } from 'lucide-react';

interface NavigationProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Navigation({ isCollapsed, onToggleCollapse, isMobileOpen = false, onCloseMobile }: NavigationProps) {
  const navItems = [
    { id: 'dashboard', path: '/', label: 'Dashboard', icon: Home },
    { id: 'vocabulary', path: '/vocabulary', label: 'Vocabulary', icon: Book },
    { id: 'exercises', path: '/exercises', label: 'Exercises', icon: Book },
    { id: 'import', path: '/import', label: 'Import', icon: Upload },
    { id: 'practice', path: '/practice', label: 'Reading & Typing', icon: Book },
    { id: 'review', path: '/review', label: 'Review', icon: RotateCcw },
    { id: 'collections', path: '/collections', label: 'Collections', icon: FolderOpen },
    { id: 'statistics', path: '/statistics', label: 'Statistics', icon: BarChart3 },
    { id: 'settings', path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden animate-in fade-in-0 duration-200"
          onClick={onCloseMobile}
        />
      )}
      <nav className={`border-r border-[#c2c7cc]/50 bg-[#f2f4f5] flex flex-col h-screen fixed left-0 top-0 transition-all duration-300 z-25 shadow-sm ${
        isCollapsed ? 'w-16 lg:w-16' : 'w-56 lg:w-56'
      } ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {isCollapsed ? (
          <div className="h-16 flex items-center justify-center border-b border-[#c2c7cc]/30">
            <button
              onClick={onToggleCollapse}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[#eceeef] text-[#002434] transition-all duration-200 active:scale-95 cursor-pointer"
              title="Expand Sidebar"
            >
              <Sparkles className="w-[18px] h-[18px] text-teal-600 flex-shrink-0 animate-pulse" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <div className="h-16 flex items-center justify-between px-5 border-b border-[#c2c7cc]/30">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center border border-teal-500/20">
                <Sparkles className="w-4 h-4 text-teal-600 flex-shrink-0" strokeWidth={1.5} />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-[15px] tracking-tight text-[#002434] leading-none">Voca</span>
                <span className="text-[9px] text-[#42474b] font-bold tracking-wider uppercase mt-0.5">Learn Smarter</span>
              </div>
            </div>
            <button
              onClick={onToggleCollapse}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#eceeef] text-[#42474b] hover:text-[#002434] transition-all duration-200 cursor-pointer active:scale-95"
              title="Collapse Sidebar"
            >
              <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.5} />
            </button>
          </div>
        )}

        <div className="flex-1 py-4 flex flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.id}
                to={item.path}
                title={isCollapsed ? item.label : undefined}
                end={item.path === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 py-2 ${isCollapsed ? 'justify-center mx-2 px-0' : 'px-3 mx-3'} my-0.5 rounded-xl transition-all text-[13.5px] font-bold ${
                    isActive
                      ? 'text-[#002434] bg-[#e6e8e9] border border-[#c2c7cc]/40 shadow-sm'
                      : 'text-[#42474b] hover:bg-[#eceeef] hover:text-[#002434]'
                  }`
                }
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={1.5} />
                {!isCollapsed && <span className="text-[13.5px]">{item.label}</span>}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </>
  );
}
