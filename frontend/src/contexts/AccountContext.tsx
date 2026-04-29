import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

/**
 * Account data structure returned by the backend
 */
export interface Account {
  id: number;
  name: string;
  balance: number;
  isPaper: boolean;
  accountNumber: string;
  equity: number;
  buyingPower: number;
  unrealizedPnl: number;
  realizedPnl: number;
  marginUsed: number;
}

/**
 * Account context value
 */
interface AccountContextValue {
  accounts: Account[];
  selectedAccountId: number | null;
  selectedAccount: Account | null;
  setSelectedAccountId: (accountId: number) => void;
  refreshAccounts: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Account context - provides global account state management
 */
const AccountContext = createContext<AccountContextValue | undefined>(undefined);

interface AccountProviderProps {
  children: ReactNode;
}

/**
 * AccountProvider - manages account state and selection
 *
 * Features:
 * - Fetches all accounts on mount
 * - Auto-selects paper trading account if available, otherwise first account
 * - Persists selection to localStorage
 * - Provides account switching functionality
 * - Auto-refreshes account data every 10 seconds
 */
export function AccountProvider({ children }: AccountProviderProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountIdState] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch accounts from backend
  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/account');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to fetch accounts');
      }

      if (data.success && Array.isArray(data.accounts)) {
        setAccounts(data.accounts);
        setError(null);

        // Auto-select account if none selected
        if (selectedAccountId === null && data.accounts.length > 0) {
          // Try to restore from localStorage
          const savedAccountId = localStorage.getItem('selectedAccountId');
          if (savedAccountId) {
            const accountExists = data.accounts.find((a: Account) => a.id === Number(savedAccountId));
            if (accountExists) {
              setSelectedAccountIdState(Number(savedAccountId));
              console.log(`✅ Restored account from localStorage: ${accountExists.name} (${savedAccountId})`);
              return;
            }
          }

          // Otherwise, auto-select practice/paper trading account if available
          // Check for isPaper flag OR "prac" in account name (case-insensitive)
          const practiceAccount = data.accounts.find((a: Account) =>
            a.isPaper || a.name.toLowerCase().includes('prac')
          );
          if (practiceAccount) {
            setSelectedAccountIdState(practiceAccount.id);
            localStorage.setItem('selectedAccountId', String(practiceAccount.id));
            console.log(`✅ Auto-selected practice account: ${practiceAccount.name}`);
          } else {
            // Fallback to first account
            setSelectedAccountIdState(data.accounts[0].id);
            localStorage.setItem('selectedAccountId', String(data.accounts[0].id));
            console.log(`✅ Auto-selected first account: ${data.accounts[0].name}`);
          }
        }
      } else {
        throw new Error('Invalid response format from backend');
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch accounts');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch on mount
  useEffect(() => {
    fetchAccounts();

    // Auto-refresh accounts every 5 minutes (reduced from 60s - account data doesn't change often)
    // Balance only updates when orders fill or P&L realizes
    const interval = setInterval(fetchAccounts, 300000); // 5 minutes

    return () => clearInterval(interval);
  }, []);

  // Handle account selection change
  const setSelectedAccountId = (accountId: number) => {
    setSelectedAccountIdState(accountId);
    localStorage.setItem('selectedAccountId', String(accountId));

    const account = accounts.find(a => a.id === accountId);
    console.log(`🔄 Switched to account: ${account?.name} (${accountId})${account?.isPaper ? ' [PAPER]' : ' [LIVE]'}`);
  };

  // Get currently selected account object
  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || null;

  const value: AccountContextValue = {
    accounts,
    selectedAccountId,
    selectedAccount,
    setSelectedAccountId,
    refreshAccounts: fetchAccounts,
    isLoading,
    error
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

/**
 * useAccount hook - access account context
 *
 * Usage:
 * ```tsx
 * const { selectedAccountId, selectedAccount, accounts, setSelectedAccountId } = useAccount();
 * ```
 */
export function useAccount() {
  const context = useContext(AccountContext);
  if (context === undefined) {
    throw new Error('useAccount must be used within an AccountProvider');
  }
  return context;
}
