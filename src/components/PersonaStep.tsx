import React, { useState } from 'react';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { AIPersona } from '../types';
import PersonaFields from './PersonaFields';

export default function PersonaStep({
  persona,
  onSavePersona,
  onDone,
}: {
  persona: AIPersona;
  onSavePersona: (p: AIPersona) => Promise<void>;
  onDone: () => void;
}) {
  const [tone, setTone] = useState(persona.tone);
  const [instructions, setInstructions] = useState(persona.customInstructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await onSavePersona({ ...persona, tone, customInstructions: instructions });
      setSaved(true);
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Failed to save persona.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PersonaFields tone={tone} onToneChange={setTone} instructions={instructions} onInstructionsChange={setInstructions} />
      {error && <div className="status-danger text-sm p-3.5 rounded-xl font-sans">{error}</div>}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || !tone.trim()}
          className="btn-copilot inline-flex items-center gap-2.5 font-sans text-xs uppercase tracking-wider px-7 py-3.5"
        >
          {saving ? 'Saving…' : 'Save and continue'}
          {!saving && <ArrowRight className="h-4 w-4" />}
        </button>
        {saved && <span className="inline-flex items-center gap-1.5 font-sans text-sm text-emerald-300"><CheckCircle className="h-4 w-4" />Saved</span>}
      </div>
    </div>
  );
}
