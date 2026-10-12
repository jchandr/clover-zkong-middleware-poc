import { useState } from 'react';
import { OnboardingView } from './components/OnboardingView';
import { IntegrationsListView } from './components/IntegrationsListView';
import { LayoutGrid, UserPlus } from 'lucide-react';

export function App() {
  const getInitialView = (): 'onboarding' | 'integrations' => {
    const path = window.location.pathname;
    if (path.startsWith('/integrations')) return 'integrations';
    return 'onboarding';
  };

  const [activeTab, setActiveTab] = useState<'onboarding' | 'integrations'>(getInitialView());

  const switchTab = (tab: 'onboarding' | 'integrations') => {
    setActiveTab(tab);
    window.history.pushState({}, '', tab === 'integrations' ? '/integrations' : '/onboarding');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => switchTab('onboarding')}>
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-extrabold text-lg shadow-sm">
              Z
            </div>
            <div>
              <span className="font-extrabold text-slate-900 text-lg tracking-tight">Clokong</span>
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                POS ↔ ESL Sync
              </span>
            </div>
          </div>

          <nav className="flex items-center space-x-1 sm:space-x-2">
            <button
              onClick={() => switchTab('onboarding')}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-colors cursor-pointer ${
                activeTab === 'onboarding'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>Onboarding</span>
            </button>
            <button
              onClick={() => switchTab('integrations')}
              className={`px-3.5 py-2 rounded-xl text-sm font-semibold flex items-center space-x-2 transition-colors cursor-pointer ${
                activeTab === 'integrations'
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Integrations</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="py-6">
        {activeTab === 'onboarding' ? <OnboardingView /> : <IntegrationsListView />}
      </main>
    </div>
  );
}

export default App;
