import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Clock } from 'lucide-react';
import { isConnected } from '../lib/ws';
import { useAccount } from '../contexts/AccountContext';

interface MetricsBarProps {
  className?: string;
}

export default function MetricsBar({ className = '' }: MetricsBarProps) {
  const { selectedAccount, isLoading: accountLoading } = useAccount();
  const [wsConnected, setWsConnected] = useState(false);
  const [sessionTime, setSessionTime] = useState('00:00:00');

  useEffect(() => {
    // Update time every second for live feel
    const updateTime = () => {
      const now = new Date();
      setSessionTime(now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }));
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    const wsCheck = setInterval(() => setWsConnected(isConnected()), 5000);

    return () => {
      clearInterval(timer);
      clearInterval(wsCheck);
    };
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  if (accountLoading) {
    return (
      <div className={`flex items-center gap-4 ${className}`}>
        <div className="text-xs font-mono text-white/30">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-5 ${className}`}>
      {/* Connection Status */}
      <div className="flex items-center gap-2">
        {wsConnected ? (
          <>
            <div className="relative">
              <Wifi size={14} className="text-[#00FF88]" />
              <div className="absolute inset-0 animate-ping">
                <Wifi size={14} className="text-[#00FF88] opacity-50" />
              </div>
            </div>
            <span className="text-xs font-mono font-medium text-[#00FF88] uppercase tracking-wider">
              Connected
            </span>
          </>
        ) : (
          <>
            <WifiOff size={14} className="text-[#FF3B5C]" />
            <span className="text-xs font-mono font-medium text-[#FF3B5C] uppercase tracking-wider">
              Offline
            </span>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-white/10" />

      {/* Session Time */}
      <div className="flex items-center gap-2">
        <Clock size={12} className="text-[#00D9FF]/60" />
        <span className="font-mono text-sm text-white/80 tabular-nums">{sessionTime}</span>
      </div>

      {/* Account Info */}
      {selectedAccount && (
        <>
          <div className="w-px h-6 bg-white/10" />

          {/* Balance Display */}
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Balance</span>
            <span className="font-mono text-base font-bold text-white tabular-nums" style={{
              textShadow: '0 0 20px rgba(0, 217, 255, 0.3)'
            }}>
              {formatCurrency(selectedAccount.balance)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
