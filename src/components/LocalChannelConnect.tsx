import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, X } from 'lucide-react';
import {
  getWhatsAppPairingStatus,
  startWhatsAppPairing,
  type WhatsAppPairingState,
} from '../lib/api';

interface ModalProps {
  onClose: () => void;
  onConnected: () => void;
}

function Shell({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 220 }}
        className="zone-b-grey3 border border-white/20 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col text-left max-h-[90vh]"
      >
        <header className="p-5 border-b border-white/[0.07] bg-black/40 flex justify-between items-center">
          <div>
            <h4 className="font-sans font-bold text-base text-white">{title}</h4>
            <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="p-6 space-y-4 overflow-y-auto">{children}</div>
      </motion.div>
    </motion.div>
  );
}


const ErrorBox = ({ message }: { message: string }) =>
  message ? <div className="status-danger text-xs p-3 rounded-xl leading-relaxed font-sans">{message}</div> : null;

const Connected = ({ text, onClose }: { text: string; onClose: () => void }) => (
  <div className="space-y-4 text-center py-4">
    <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
    <p className="text-sm font-bold text-white font-sans">Connected</p>
    <p className="text-xs text-white/60 leading-relaxed font-sans">{text}</p>
    <button onClick={onClose} className="w-full btn-light-primary py-3 text-xs font-bold cursor-pointer">Done</button>
  </div>
);

export function WhatsAppQrModal({ onClose, onConnected }: ModalProps) {
  const [state, setState] = useState<WhatsAppPairingState | null>(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    let alive = true;
    const poll = async () => {
      try {
        const next = await getWhatsAppPairingStatus();
        if (!alive) return;
        setState(next);
        if (next.status === 'connected') {
          alive = false;
          clearInterval(timer);
          onConnected();
        }
      } catch (err: any) {
        if (alive) setError(err.message || 'Lost connection to the server.');
      }
    };
    const timer = setInterval(poll, 2000);
    void poll();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [started]);

  const generate = async () => {
    setError('');
    try {
      setState(await startWhatsAppPairing());
      setStarted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to start WhatsApp pairing.');
    }
  };

  return (
    <Shell title="Connect WhatsApp" subtitle="Pair your phone — no Meta Business verification needed" onClose={onClose}>
      {state?.status === 'connected' ? (
        <Connected text={`WhatsApp is linked${state.phone ? ` as +${state.phone}` : ''}. Remlin will reply to incoming chats automatically.`} onClose={onClose} />
      ) : (
        <>
          <p className="text-xs text-white/60 leading-relaxed font-sans">
            Click Generate QR Code, then on your phone open WhatsApp → Settings → Linked Devices → Link a Device and scan the code.
          </p>
          <ErrorBox message={error || state?.error || ''} />
          {state?.status === 'qr' && state.qr ? (
            <div className="bg-white p-3 rounded-xl w-fit mx-auto">
              <img src={state.qr} alt="WhatsApp pairing QR code" className="w-64 h-64" />
            </div>
          ) : started && !state?.error ? (
            <p className="text-xs text-white/50 text-center font-sans">Preparing QR code…</p>
          ) : null}
          <button onClick={generate} disabled={started && state?.status !== 'error'} className="w-full btn-accent py-3 text-xs font-bold cursor-pointer disabled:opacity-40">
            {started && state?.status !== 'error' ? 'Waiting for scan…' : 'Generate QR Code'}
          </button>
        </>
      )}
    </Shell>
  );
}
