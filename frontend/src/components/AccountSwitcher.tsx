import { useAccount } from '../contexts/AccountContext';
import { AlertTriangle, Wallet } from 'lucide-react';

interface AccountSwitcherProps {
  className?: string;
}

export default function AccountSwitcher({ className = '' }: AccountSwitcherProps) {
  const { accounts, selectedAccountId, selectedAccount, setSelectedAccountId, isLoading } = useAccount();

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${className}`} style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <div className="w-3 h-3 border-2 border-[#00D9FF]/30 border-t-[#00D9FF] rounded-full animate-spin" />
        <span className="text-xs font-mono text-white/40">Loading...</span>
      </div>
    );
  }

  if (!selectedAccount) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${className}`} style={{
        background: 'rgba(255, 59, 92, 0.1)',
        border: '1px solid rgba(255, 59, 92, 0.2)'
      }}>
        <AlertTriangle size={14} className="text-[#FF3B5C]" />
        <span className="text-xs font-mono text-[#FF3B5C]">No account</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Horizontal Account Tabs */}
      {accounts.map((account) => {
        const isSelected = account.id === selectedAccountId;

        return (
          <button
            key={account.id}
            onClick={() => setSelectedAccountId(account.id)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200"
            style={{
              background: isSelected
                ? 'linear-gradient(135deg, rgba(0, 217, 255, 0.15) 0%, rgba(168, 85, 247, 0.1) 100%)'
                : 'rgba(255, 255, 255, 0.03)',
              border: isSelected
                ? '1px solid rgba(0, 217, 255, 0.3)'
                : '1px solid rgba(255, 255, 255, 0.06)',
              boxShadow: isSelected ? '0 0 15px rgba(0, 217, 255, 0.1)' : 'none'
            }}
          >
            {/* Account Type Badge */}
            {account.isPaper ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono uppercase"
                style={{
                  background: 'rgba(255, 184, 0, 0.15)',
                  color: '#FFB800',
                  border: '1px solid rgba(255, 184, 0, 0.3)'
                }}>
                Paper
              </span>
            ) : (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono uppercase"
                style={{
                  background: 'rgba(0, 255, 136, 0.15)',
                  color: '#00FF88',
                  border: '1px solid rgba(0, 255, 136, 0.3)'
                }}>
                <div className="w-1.5 h-1.5 bg-[#00FF88] rounded-full animate-pulse" />
                Live
              </span>
            )}

            {/* Account Name */}
            <div className="flex items-center gap-1.5">
              <Wallet size={12} className={isSelected ? 'text-[#00D9FF]' : 'text-white/40'} />
              <span className={`text-xs font-medium ${isSelected ? 'text-white' : 'text-white/60'}`}>
                {account.name}
              </span>
            </div>

            {/* Balance */}
            <span className={`font-mono text-xs font-semibold ${isSelected ? 'text-[#00D9FF]' : 'text-white/40'}`}>
              ${account.balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          </button>
        );
      })}

      {/* Live Trading Warning Icon */}
      {selectedAccount && !selectedAccount.isPaper && (
        <div className="flex items-center ml-1" title="Live Trading - Real capital at risk">
          <AlertTriangle size={14} className="text-[#FF3B5C]/60" />
        </div>
      )}
    </div>
  );
}
