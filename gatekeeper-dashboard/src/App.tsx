import { useState } from 'react';
import OverviewView from './OverviewView';
import SessionsView from './SessionsView';
import TrafficView from './TrafficView';
import UsersView from './UsersView';
import PoliciesView from './PoliciesView';
import PostureView from './PostureView';
import { Sidebar } from './components/ui/Sidebar';
import type { ViewType } from './components/ui/Sidebar';
import { Topbar } from './components/ui/Topbar';

export default function App() {
  const [view, setView] = useState<ViewType>('overview');

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950 font-sans text-gray-100">
      <Sidebar currentView={view} onViewChange={setView} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />

        <main className="flex-1 overflow-y-auto">
          {view === 'overview' && <OverviewView />}
          {view === 'traffic' && <TrafficView />}
          {view === 'sessions' && <SessionsView />}
          {view === 'users' && <UsersView />}
          {view === 'policies' && <PoliciesView />}
          {view === 'posture' && <PostureView />}
        </main>
      </div>
    </div>
  );
}
