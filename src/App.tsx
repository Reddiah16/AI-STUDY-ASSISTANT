import { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import LandingPage from './components/LandingPage';
import AuthForm from './components/AuthForm';
import Dashboard from './components/Dashboard';
import ChatInterface from './components/ChatInterface';
import { fetchDocuments, type Document } from './services/db';

type ViewState = 'landing' | 'auth' | 'dashboard' | 'chat';

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'warning';
}

export default function App() {
  const [view, setView] = useState<ViewState>('landing');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [allDocs, setAllDocs] = useState<Document[]>([]);
  const [activeChatDocs, setActiveChatDocs] = useState<Document[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | undefined>();

  // Custom Toast State
  const [toast, setToast] = useState<ToastState | null>(null);
  const [toastTimeout, setToastTimeout] = useState<any>(null);

  // Show message banner helper
  const showToast = (message: string, type: 'success' | 'error' | 'warning') => {
    if (toastTimeout) clearTimeout(toastTimeout);
    setToast({ message, type });
    const timeout = setTimeout(() => {
      setToast(null);
    }, 4000);
    setToastTimeout(timeout);
  };

  useEffect(() => {
    // 1. Initial Auth Check
    const checkAuth = async () => {
      try {
        if (isSupabaseConfigured) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            setUser(session.user);
            setView('dashboard');
            // Pre-load docs
            const docs = await fetchDocuments(session.user.id);
            setAllDocs(docs);
          }
        }
      } catch (err) {
        console.error('Error during initial session verification:', err);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // 2. Listen for Auth Changes if Supabase is active
    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (session?.user) {
            setUser(session.user);
            setView('dashboard');
            const docs = await fetchDocuments(session.user.id);
            setAllDocs(docs);
          } else {
            setUser(null);
            setView('landing');
            setAllDocs([]);
          }
        }
      );

      return () => {
        subscription.unsubscribe();
      };
    } else {
      // Mock mode default loading state resolution
      setLoading(false);
    }
  }, []);

  const handleLogout = async () => {
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      } else {
        // Mock sign out
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      setUser(null);
      setView('landing');
      setAllDocs([]);
      setActiveChatDocs([]);
      showToast('Logged out successfully.', 'success');
    } catch (err: any) {
      console.error(err);
      showToast('Logout failed.', 'error');
    }
  };

  const handleAuthSuccess = async (authenticatedUser: any) => {
    setUser(authenticatedUser);
    setView('dashboard');
    try {
      const docs = await fetchDocuments(authenticatedUser.id);
      setAllDocs(docs);
    } catch (err) {
      console.error('Failed to pre-fetch documents:', err);
    }
  };

  // Navigates from dashboard to chat workspace
  const handleStartChat = async (selectedDocs: Document[], sessionId?: string) => {
    try {
      const docs = await fetchDocuments(user.id);
      setAllDocs(docs);
      const validDocs = selectedDocs.filter(d => docs.some(a => a.id === d.id));
      setActiveChatDocs(validDocs);
      setActiveChatSessionId(sessionId);
      setView('chat');
    } catch (err) {
      console.error(err);
      setActiveChatSessionId(sessionId);
      setView('chat');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-base)' }}>
        <div className="spinner" style={{ width: '48px', height: '48px' }}></div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Dynamic View Swapper */}
      {view === 'landing' && (
        <LandingPage onGetStarted={() => setView(user ? 'dashboard' : 'auth')} />
      )}

      {view === 'auth' && (
        <div style={{ display: 'flex', width: '100%', minHeight: '100vh', background: 'radial-gradient(circle at 50% 25%, hsla(250, 89%, 65%, 0.08), transparent 45%), var(--bg-base)' }}>
          <AuthForm 
            onAuthSuccess={handleAuthSuccess} 
            showToast={showToast} 
            onBackToLanding={() => setView('landing')} 
          />
        </div>
      )}

      {view === 'dashboard' && user && (
        <div style={{ display: 'flex', width: '100%', minHeight: '100vh', overflowY: 'auto' }}>
          <Dashboard 
            user={user} 
            onStartChat={handleStartChat} 
            showToast={showToast} 
            onLogout={handleLogout} 
          />
        </div>
      )}

      {view === 'chat' && user && (
      <ChatInterface 
          user={user} 
          allDocuments={allDocs} 
          initialSelectedDocs={activeChatDocs}
          initialSessionId={activeChatSessionId}
          onBackToDashboard={async () => {
            const docs = await fetchDocuments(user.id);
            setAllDocs(docs);
            setView('dashboard');
          }}
          showToast={showToast} 
        />
      )}

      {/* Floating Status Toast Alert */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{toast.message}</div>
        </div>
      )}
    </div>
  );
}
