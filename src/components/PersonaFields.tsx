import React from 'react';
import { MessageCircle } from 'lucide-react';
import AutoTextarea from './AutoTextarea';

/** Tone of Voice, Response Format, Sales Rules and Order Management — shared by AI Persona and Onboarding. */
export default function PersonaFields({
  tone,
  onToneChange,
  instructions,
  onInstructionsChange,
}: {
  tone: string;
  onToneChange: (v: string) => void;
  instructions: string;
  onInstructionsChange: (v: string) => void;
}) {
  return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6 items-start">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="font-sans font-semibold text-[15px] text-white">Tone of Voice</h2>
                  <p className="text-[13px] text-white/50">Define how your AI assistant sounds</p>
                </div>
                <AutoTextarea
                  rows={4}
                  value={tone}
                  onChange={(e) => onToneChange(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl p-3.5 font-sans text-[13px] text-white placeholder:text-white/30 outline-none focus:border-[#00a8e8]/50 focus:bg-white/[0.05] transition-all"
                  placeholder="e.g. Professional, high-end, elegant"
                />
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="font-sans font-semibold text-[15px] text-white">Response Format</h2>
                  <p className="text-[13px] text-white/50">AI responses are conversational by default</p>
                </div>
                <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3.5 flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-[#00a8e8]" />
                  <span className="text-[13px] text-white/80 font-medium">Conversational</span>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="font-sans font-semibold text-[15px] text-white">Sales Rules & Guidelines</h2>
                  <p className="text-[13px] text-white/50">Custom instructions for sales and promotions</p>
                </div>
                <AutoTextarea
                  rows={4}
                  value={instructions}
                  onChange={(e) => onInstructionsChange(e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl p-3.5 font-sans text-[13px] text-white placeholder:text-white/30 outline-none focus:border-[#00a8e8]/50 focus:bg-white/[0.05] transition-all"
                  placeholder="e.g. Free shipping on orders over $150. Suggest adding complementary accessories."
                />
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="font-sans font-semibold text-[15px] text-white">Order Management</h2>
                </div>
                <div className="bg-[#00a8e8]/5 border border-[#00a8e8]/20 rounded-xl p-4">
                  <p className="text-[13px] text-white/80 leading-relaxed">
                    When a customer confirms their order, the AI automatically places it if <span className="font-semibold text-white">AI Copilot is on</span>.
                  </p>
                </div>
              </div>
            </div>
          </div>
  );
}
