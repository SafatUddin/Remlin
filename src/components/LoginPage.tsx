import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, ArrowRight, Facebook } from 'lucide-react';
import { Tab } from '../types';
import { login, getGoogleConnectUrl, AuthResponse } from '../lib/api';

import { RemlinLogo } from './RemlinLogo';

interface LoginPageProps {
  onNavigate: (tab: Tab) => void;
  onLoginSuccess: (auth: AuthResponse) => void;
  initialError?: string;
}

export default function LoginPage({ onNavigate, onLoginSuccess, initialError }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'reset_password'>('login');

  // Login states
  const [email, setEmail] = useState('merchant@remlin.ai');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState(initialError || '');

  // Reset password states
  const [resetEmail, setResetEmail] = useState('merchant@remlin.ai');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoading(true);

    try {
      const auth = await login({ email, password });
      onLoginSuccess(auth);
    } catch (err: any) {
      setLoginError(err.message || 'Failed to sign in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Real password reset requires email verification, which isn't built yet.
    // Rather than let anyone change any account's password by typing an email,
    // point users back to sign-in instead of taking a shortcut here.
    setResetError('Password reset via email isn\'t available yet. Please contact support or sign in with your existing password.');
  };

  return (
    <div className="app-bg-gradient text-[#e2e2e2] font-sans min-h-screen flex flex-col justify-between selection:bg-white/10 selection:text-white relative overflow-y-auto">
      {/* Background soft blurs according to DESIGN.md */}
      <div className="ambient-bloom-tl" />
      <div className="ambient-bloom-br" />

      {/* Header spacer */}
      <div />

      {/* Main card section */}
      <main className="flex-grow flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[420px] zone-b-grey2 border border-white/12 p-6 sm:p-10 flex flex-col items-center rounded-2xl shadow-2xl backdrop-blur-xl"
        >
          {/* Brand Identity */}
          <div className="mb-8 flex flex-col items-center">
            <div 
              className="cursor-pointer mb-5"
              onClick={() => onNavigate('landing')}
            >
              <RemlinLogo size={32} className="w-16 h-16" />
            </div>
            
            {mode === 'login' ? (
              <>
                <h1 className="font-sans font-bold text-2xl sm:text-3xl text-white text-center mb-1 tracking-tight">Welcome Back</h1>
                <p className="text-xs text-white/50 text-center max-w-[280px] font-sans">
                  Access your sales automation dashboard
                </p>
              </>
            ) : (
              <>
                <h1 className="font-sans font-bold text-2xl sm:text-3xl text-white text-center mb-1 tracking-tight">Reset Password</h1>
                <p className="text-xs text-white/50 text-center max-w-[280px] font-sans">
                  Choose a new secure password to access your account
                </p>
              </>
            )}
          </div>

          {mode === 'login' ? (
            /* Login Form */
            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
              {loginError && (
                <div className="bg-[#ea4335]/10 border border-[#ea4335]/20 text-[#ea4335] text-[11px] p-2.5 rounded text-center font-sans">
                  {loginError}
                </div>
              )}

              {/* Email Field */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[9px] font-bold text-white/55 uppercase tracking-[0.15em]" htmlFor="email">
                  Email Address
                </label>
                <input 
                  id="email"
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#161618] border border-white/[0.06] px-3.5 py-2.5 font-sans text-xs text-white placeholder-white/20 focus:border-white/20 transition-all outline-none rounded"
                  placeholder="merchant@remlin.ai"
                />
              </div>

              {/* Password Field */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="font-sans text-[9px] font-bold text-white/55 uppercase tracking-[0.15em]" htmlFor="password">
                    Password
                  </label>
                  <button 
                    type="button"
                    onClick={() => setMode('reset_password')}
                    className="font-sans text-[9px] font-bold text-white/40 uppercase tracking-wider hover:text-white transition-colors cursor-pointer focus:outline-none"
                  >
                    Forgot Password?
                  </button>
                </div>
                
                <div className="relative">
                  <input 
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#161618] border border-white/[0.06] px-3.5 py-2.5 font-sans text-xs text-white placeholder-white/20 focus:border-white/20 transition-all outline-none pr-10 rounded"
                    placeholder="••••••••"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 bg-gradient-to-br from-[#2552c6] to-[#14307c] border border-blue-400/40 text-white shadow-[0_6px_22px_rgba(37,82,198,0.45)] hover:brightness-110 py-3.5 font-sans text-[11px] uppercase tracking-widest font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 rounded-xl"
              >
                {isLoading ? (
                  <span>SIGNING IN...</span>
                ) : (
                  <>
                    Sign In to Command Center
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </form>
          ) : (
            /* Reset Password Form */
            <form onSubmit={handleResetSubmit} className="w-full flex flex-col gap-4">
              {resetError && (
                <div className="bg-[#ea4335]/10 border border-[#ea4335]/20 text-[#ea4335] text-[11px] p-2.5 rounded text-center font-sans">
                  {resetError}
                </div>
              )}

              {/* Email Field */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[9px] font-bold text-white/55 uppercase tracking-[0.15em]" htmlFor="resetEmail">
                  Email Address
                </label>
                <input 
                  id="resetEmail"
                  type="email" 
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full bg-[#161618] border border-white/[0.06] px-3.5 py-2.5 font-sans text-xs text-white placeholder-white/20 focus:border-white/20 transition-all outline-none rounded"
                  placeholder="merchant@remlin.ai"
                />
              </div>

              {/* New Password Field */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[9px] font-bold text-white/55 uppercase tracking-[0.15em]" htmlFor="newPassword">
                  New Password
                </label>
                <div className="relative">
                  <input 
                    id="newPassword"
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-[#161618] border border-white/[0.06] px-3.5 py-2.5 font-sans text-xs text-white placeholder-white/20 focus:border-white/20 transition-all outline-none pr-10 rounded"
                    placeholder="Minimum 4 characters"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors cursor-pointer"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password Field */}
              <div className="flex flex-col gap-1.5">
                <label className="font-sans text-[9px] font-bold text-white/55 uppercase tracking-[0.15em]" htmlFor="confirmPassword">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input 
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-[#161618] border border-white/[0.06] px-3.5 py-2.5 font-sans text-xs text-white placeholder-white/20 focus:border-white/20 transition-all outline-none pr-10 rounded"
                    placeholder="Repeat password"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors cursor-pointer"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Reset Password Action Button */}
              <button 
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 bg-white hover:bg-neutral-200 text-black py-3.5 font-sans text-[11px] uppercase tracking-widest font-bold transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 rounded"
              >
                {isLoading ? (
                  <span>RESETTING...</span>
                ) : (
                  <>
                    Reset Password & Sign In
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>

              <button 
                type="button"
                onClick={() => setMode('login')}
                className="w-full text-center font-sans text-[10px] text-white/40 uppercase tracking-widest hover:text-white transition-colors py-2 mt-1 cursor-pointer focus:outline-none"
              >
                Back to Sign In
              </button>
            </form>
          )}
          {/* Divider */}
          <div className="flex items-center gap-3 w-full mt-6">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="font-sans text-[9px] text-white/30 uppercase tracking-widest font-bold">or</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          {/* Google Sign-In */}
          <button
            type="button"
            onClick={() => { window.location.href = getGoogleConnectUrl(); }}
            className="w-full mt-3 flex items-center justify-center gap-2.5 bg-transparent border border-white/[0.12] hover:border-white/25 hover:bg-white/[0.04] text-white py-3 font-sans text-[11px] uppercase tracking-widest font-bold transition-all active:scale-[0.98] rounded cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </button>

          {/* Card Footer */}
          <div className="mt-6 pt-6 border-t border-white/[0.06] w-full text-center">
            <p className="text-xs text-white/40 font-sans">
              New to Remlin? 
              <button 
                onClick={() => onNavigate('signup')}
                className="text-white font-bold hover:underline ml-1 font-sans cursor-pointer transition-colors"
              >
                Create an account
              </button>
            </p>
          </div>
        </motion.div>
      </main>

      {/* Footer Segment */}
      <footer className="w-full bg-[#050506] border-t border-white/[0.06] relative z-10 py-6">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate('landing')}>
            <span className="font-sans font-bold text-xs text-white">Remlin</span>
            <span className="text-white/35 text-[10px] font-sans">© 2024. All rights reserved.</span>
          </div>
          <div className="flex gap-6 text-[10px] text-white/40 font-sans">
            <a className="hover:text-white transition-colors" href="#">Privacy Policy</a>
            <a className="hover:text-white transition-colors" href="#">Terms of Service</a>
            <a className="hover:text-white transition-colors" href="#">API Documentation</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
