import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { Lock, Mail, User as UserIcon, ArrowRight } from 'lucide-react';

interface AuthFormProps {
  onAuthSuccess: (user: User) => void;
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void;
  onBackToLanding: () => void;
}

export default function AuthForm({ onAuthSuccess, showToast, onBackToLanding }: AuthFormProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }
    if (password.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }

    setLoading(true);

    try {
      if (isSupabaseConfigured) {
        if (isLogin) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;
          showToast('Welcome back to your study desk!', 'success');
          onAuthSuccess(data.user);
        } else {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: fullName || email.split('@')[0],
              },
            },
          });
          if (error) throw error;
          
          if (data.session) {
            showToast('Registration successful! Welcome.', 'success');
            onAuthSuccess(data.user);
          } else {
            showToast('Signup successful! Check your email for verification link.', 'success');
            setIsLogin(true);
          }
        }
      } else {
        // Mock authentication flow
        await new Promise((resolve) => setTimeout(resolve, 800));
        const mockUser = {
          id: 'mock-user-uuid-12345',
          email,
          user_metadata: {
            full_name: isLogin ? (email.split('@')[0]) : (fullName || email.split('@')[0]),
          },
        };
        showToast(
          isLogin 
            ? 'Logged in successfully (Demo mode).' 
            : 'Account registered successfully (Demo mode).', 
          'success'
        );
        onAuthSuccess(mockUser);
      }
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Authentication failed. Please try again.';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card glass auth-panel" style={{ width: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h2 className="gradient-text" style={{ fontSize: '1.8rem', marginBottom: '8px' }}>
          {isLogin ? 'Sign In' : 'Create Account'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {isLogin ? 'Unlock your personalized study brain' : 'Get started with AI-driven revision tools'}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {!isLogin && (
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <div style={{ position: 'relative' }}>
              <UserIcon 
                size={18} 
                style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} 
              />
              <input
                type="text"
                className="input-field"
                placeholder="Alex Morgan"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={{ paddingLeft: '40px' }}
              />
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Email Address</label>
          <div style={{ position: 'relative' }}>
            <Mail 
              size={18} 
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} 
            />
            <input
              type="email"
              className="input-field"
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ paddingLeft: '40px' }}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Password</label>
          <div style={{ position: 'relative' }}>
            <Lock 
              size={18} 
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} 
            />
            <input
              type="password"
              className="input-field"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingLeft: '40px' }}
              required
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: '8px' }}>
          {loading ? (
            <div className="spinner" style={{ width: '18px', height: '18px' }}></div>
          ) : (
            <>
              {isLogin ? 'Sign In' : 'Register'} <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>

      <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.9rem' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          {isLogin ? "Don't have an account? " : 'Already registered? '}
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary-light)',
              cursor: 'pointer',
              fontWeight: 600,
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            {isLogin ? 'Register now' : 'Sign in here'}
          </button>
        </p>
      </div>

      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <button
          type="button"
          onClick={onBackToLanding}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          ← Back to homepage
        </button>
      </div>
    </div>
  );
}
