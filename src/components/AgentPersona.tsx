import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  Save,
  CheckCircle,
  AlertCircle,
  MessageCircle,
  Building2,
  Globe,
  Phone,
  MapPin
} from 'lucide-react';
import { AIPersona } from '../types';
import type { PublicMerchant, PublicStore, OnboardingResponse } from '../lib/api';
import BusinessProfileForm from './BusinessProfileForm';
import PersonaFields from './PersonaFields';
import DashboardHeader from './DashboardHeader';

interface AgentPersonaProps {
  persona: AIPersona;
  onSavePersona: (newPersona: AIPersona) => Promise<void>;
  merchant: PublicMerchant | null;
  store: PublicStore | null;
  onBusinessSaved: (response: OnboardingResponse) => void;
}

export default function AgentPersona({
  persona,
  onSavePersona,
  merchant,
  store,
  onBusinessSaved
}: AgentPersonaProps) {
  const [personaTone, setPersonaTone] = useState(persona.tone);
  const [personaStyle] = useState<'bullets' | 'narrative'>('narrative'); // Always narrative now
  const [personaInstructions, setPersonaInstructions] = useState(persona.customInstructions);
  const [autoFinalizeOrdersAlways, setAutoFinalizeOrdersAlways] = useState(!!persona.autoFinalizeOrdersAlways);
  const openingText = persona.openingText || '';
  const [shareBusinessInfo, setShareBusinessInfo] = useState(persona.shareBusinessInfo ?? true);

  const [isSavingPersona, setIsSavingPersona] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [personaError, setPersonaError] = useState('');

  const handleSavePersonaClick = async () => {
    setPersonaError('');
    setIsSavingPersona(true);
    try {
      await onSavePersona({
        tone: personaTone,
        style: personaStyle,
        customInstructions: personaInstructions,
        autoFinalizeOrdersAlways,
        openingText,
        shareBusinessInfo
      });
      setShowSaveSuccess(true);
      setTimeout(() => {
        setShowSaveSuccess(false);
      }, 3000);
    } catch (err: any) {
      setPersonaError(err.message || 'Failed to save persona.');
    } finally {
      setIsSavingPersona(false);
    }
  };

  return (
    <div className="w-full flex-grow flex flex-col text-left">
      <DashboardHeader title="AI PERSONA" searchPlaceholder="Search settings…" />

      <div className="w-full flex-grow p-6 md:p-8 overflow-y-auto">
        <div className="w-full space-y-6">
          {/* Page Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="font-sans font-bold text-[24px] text-white flex items-center gap-3 tracking-tight">
                <Sparkles className="text-[#00a8e8] h-6 w-6" />
                AI Agent Persona
              </h1>
              <p className="text-[14px] text-white/60">
                Configure how your AI assistant communicates with customers and handles orders
              </p>
            </div>
          </div>

          <PersonaFields
            tone={personaTone}
            onToneChange={setPersonaTone}
            instructions={personaInstructions}
            onInstructionsChange={setPersonaInstructions}
          />

          {/* Your business — the details the AI answers from */}
          {merchant && store && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="font-sans font-semibold text-[15px] text-white flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-[#00a8e8]" />
                    Your business
                  </h2>
                  <p className="text-[13px] text-white/50">
                    Everything your assistant says starts here: who you are, what you sell, when you are open, delivery and payment.
                  </p>
                </div>
                <button
              type="button"
              role="switch"
              aria-checked={shareBusinessInfo}
              onClick={() => setShareBusinessInfo(!shareBusinessInfo)}
              title={shareBusinessInfo ? 'The AI shares your phone, address and open hours with customers' : 'The AI will not share your phone, address or open hours'}
              className="inline-flex items-center gap-2.5 rounded-full bg-white/[0.05] pl-3.5 pr-2 py-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.4)] cursor-pointer"
            >
              <Building2 className="h-3.5 w-3.5 text-[#00a8e8]" />
              <span className="font-sans text-xs font-semibold text-white/80">Share business information</span>
              <span className={`relative w-9 h-5 rounded-full transition-all flex-shrink-0 ${shareBusinessInfo ? 'bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff]' : 'bg-white/10'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${shareBusinessInfo ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
            </button>
              </div>
              <BusinessProfileForm merchant={merchant} store={store} onComplete={onBusinessSaved} submitLabel="Save your business" />
            </div>
          )}

          {/* Save Button - Full Width at Bottom */}
          <div className="space-y-3 pt-4">
            <button
              onClick={handleSavePersonaClick}
              disabled={isSavingPersona}
              className="w-full bg-gradient-to-r from-[#2176ff] via-[#00a8e8] to-[#00d2ff] hover:from-[#1a5fd9] hover:via-[#0096d0] hover:to-[#00b8e0] py-3.5 rounded-xl font-sans font-bold text-[14px] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[#00a8e8]/25"
            >
              <Save className="h-4 w-4" />
              {isSavingPersona ? 'Redeploying Model...' : 'Save & Redeploy Persona'}
            </button>

            <AnimatePresence>
              {personaError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-red-500/10 border border-red-500/20 rounded-xl p-3.5 flex items-center gap-3"
                >
                  <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                  <p className="text-[13px] text-red-300/90">{personaError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showSaveSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3.5 flex items-center gap-3"
                >
                  <CheckCircle className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                  <p className="text-[13px] text-emerald-300/90">Persona model redeployed successfully!</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>
      </div>
    </div>
  );
}
