import { useState } from 'react';
import OverviewView from './OverviewView';
import SessionsView from './SessionsView';
import TrafficView from './TrafficView';
import UsersView from './UsersView';

type View = 'overview' | 'traffic' | 'sessions' | 'users';

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: 'overview', label: 'Dashboard', icon: '📊' },
  { id: 'traffic', label: 'Live Traffic', icon: '📡' },
  { id: 'sessions', label: 'Sessions', icon: '🔑' },
  { id: 'users', label: 'Users', icon: '👤' },
];

export default function App() {
  const [view, setView] = useState<View>('overview');

  return (
    <div className="min-h-screen flex bg-surface-950">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-gray-800 bg-surface-900 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-sm">
              🛡️
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">Gatekeeper</h1>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Admin Panel</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${view === item.id
                  ? 'bg-brand-500/15 text-brand-300 border border-brand-500/25'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] border border-transparent'
                }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot" />
            Zero-Trust Active
          </div>
          <p className="text-[10px] text-gray-600 mt-1">v0.4.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-8">
          {view === 'overview' && <OverviewView />}
          {view === 'traffic' && <TrafficView />}
          {view === 'sessions' && <SessionsView />}
          {view === 'users' && <UsersView />}
        </div>
      </main>
    </div>
  );
}
