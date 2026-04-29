import { DollarSign } from 'lucide-react';
import { AutomationConfig as ConfigType } from '../hooks/useAutomation';

/**
 * =============================================================================
 * DYNAMIC POSITION SIZE CALCULATOR
 * =============================================================================
 *
 * Sole remaining sidebar control: target risk range drives auto-sizing for
 * every entry (automated and manual). All other automation configuration
 * (trailing stops, safety limits, feature flags) has been removed from the UI
 * but remains in the underlying `config` state and defaults.
 * =============================================================================
 */

interface AutomationConfigProps {
  config: ConfigType;
  onConfigChange: (config: ConfigType) => void;
  className?: string;
}

export default function AutomationConfig({
  config,
  onConfigChange,
  className = ''
}: AutomationConfigProps) {

  const updateConfig = (updates: Partial<ConfigType>) => {
    onConfigChange({ ...config, ...updates });
  };

  return (
    <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-5 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-800">
        <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
          <DollarSign className="text-green-400" size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Dynamic Size Calculator</h3>
          <p className="text-xs text-gray-400">Target risk range drives contract sizing</p>
        </div>
      </div>

      {/* === Position Sizing === */}
      <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/50">
        <div className="space-y-3">
          {/* Target Risk Range */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Target Risk Range (USD)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  type="number"
                  min="50"
                  max="1000"
                  step="10"
                  value={config.targetRiskMin}
                  onChange={(e) => updateConfig({ targetRiskMin: parseInt(e.target.value) })}
                  className="w-full bg-gray-700/70 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-green-500/50"
                  placeholder="Min"
                />
                <p className="text-xs text-gray-500 mt-1">Min Risk</p>
              </div>
              <div>
                <input
                  type="number"
                  min="50"
                  max="1000"
                  step="10"
                  value={config.targetRiskMax}
                  onChange={(e) => updateConfig({ targetRiskMax: parseInt(e.target.value) })}
                  className="w-full bg-gray-700/70 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-green-500/50"
                  placeholder="Max"
                />
                <p className="text-xs text-gray-500 mt-1">Max Risk</p>
              </div>
            </div>
          </div>

          {/* Tick Configuration (Display only) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Tick Size</label>
              <div className="bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-400">
                ${config.tickSize.toFixed(2)}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Tick Value</label>
              <div className="bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-400">
                ${config.tickValue.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
