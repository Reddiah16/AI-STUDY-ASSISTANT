import { BookOpen, Brain, FileText, Sparkles, LogIn } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabase';

interface LandingPageProps {
  onGetStarted: () => void;
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="landing-hero" style={{ width: '100%' }}>
      <div className="landing-glow"></div>
      
      {/* Configuration Status Badge */}
      <div 
        style={{
          position: 'absolute',
          top: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          borderRadius: '20px',
          background: 'rgba(14, 18, 28, 0.4)',
          border: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: isSupabaseConfigured ? 'var(--success)' : 'var(--warning)',
          animation: 'fadeIn 1s ease-out'
        }}
      >
        <span 
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isSupabaseConfigured ? 'var(--success)' : 'var(--warning)',
            boxShadow: isSupabaseConfigured ? '0 0 8px var(--success)' : '0 0 8px var(--warning)'
          }}
        ></span>
        {isSupabaseConfigured ? 'Supabase Backend Connected' : 'Demo Mode (LocalStorage)'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
        <div 
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--primary-glow)',
            border: '1px solid var(--border-focus)',
            padding: '6px 16px',
            borderRadius: '20px',
            color: 'var(--primary-light)',
            fontSize: '0.85rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '24px',
            animation: 'fadeIn 0.6s ease-out'
          }}
        >
          <Sparkles size={14} /> The Ultimate Study Buddy
        </div>

        <h1 className="landing-title">
          Supercharge Your Exam Prep with <br />
          <span className="gradient-text">AI Study Assistant</span>
        </h1>

        <p className="landing-subtitle">
          Upload textbook PDFs, lecture notes, or assignments, and chat directly with your course materials. Get precise, grounded responses tailored for students.
        </p>

        <div className="landing-ctas">
          <button className="btn btn-primary" onClick={onGetStarted} style={{ padding: '14px 28px', fontSize: '1.05rem' }}>
            Get Started Free <LogIn size={18} />
          </button>
        </div>

        <div className="landing-features">
          <div className="feature-box">
            <div className="feature-box-icon">
              <FileText size={22} />
            </div>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>Storage & Files</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
              Upload your syllabus, essays, and PDF study guides to Supabase Storage. Manage notes in one centralized place.
            </p>
          </div>

          <div className="feature-box">
            <div className="feature-box-icon">
              <Brain size={22} />
            </div>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>RAG Vector Retrieval</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
              Automatically chunks documents and maps question embeddings. Pre-configured for Postgres vectors to retrieve only relevant context.
            </p>
          </div>

          <div className="feature-box">
            <div className="feature-box-icon">
              <BookOpen size={22} />
            </div>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>Intelligent Workspace</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
              Chat with specific files selected at runtime. Watch the AI reference its source chapters so you can study with confidence.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
