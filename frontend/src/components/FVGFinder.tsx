import { useState } from "react";
import { Layers, Eye, EyeOff } from "lucide-react";

export interface FVG {
  time: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  entry: number;
}

interface FVGFinderProps {
  bullishCount: number;
  bearishCount: number;
  onToggleEnabled: (enabled: boolean) => void;
  className?: string;
}

export default function FVGFinder({
  bullishCount,
  bearishCount,
  onToggleEnabled,
  className = ""
}: FVGFinderProps) {
  const [enabled, setEnabled] = useState<boolean>(true);

  const handleToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    onToggleEnabled(newEnabled);
  };

  return (
    <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-3 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-1.5">
          <Layers className="text-purple-500" size={18} />
          FVG Finder
        </h3>
        <button
          onClick={handleToggle}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            enabled
              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30'
              : 'bg-gray-700/50 text-gray-400 border border-gray-600/30 hover:bg-gray-600/50'
          }`}
        >
          {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <div className="bg-green-500/10 border border-green-500/30 p-2.5 rounded-lg">
          <div className="text-xs text-gray-400 mb-0.5 font-medium">Bullish FVGs</div>
          <div className="text-2xl font-bold text-green-500">{bullishCount}</div>
          <div className="text-xs text-green-400/70 mt-0.5">Gap Up</div>
        </div>

        <div className="bg-red-500/10 border border-red-500/30 p-2.5 rounded-lg">
          <div className="text-xs text-gray-400 mb-0.5 font-medium">Bearish FVGs</div>
          <div className="text-2xl font-bold text-red-500">{bearishCount}</div>
          <div className="text-xs text-red-400/70 mt-0.5">Gap Down</div>
        </div>
      </div>

      <div className="text-xs text-gray-400 bg-gray-800/50 p-2 rounded-lg border border-gray-700/50">
        <div>Fair Value Gap: Price gap between 3 candles</div>
      </div>

      {enabled && (
        <div className="mt-2.5 bg-purple-500/10 border border-purple-500/30 p-1.5 rounded-lg">
          <div className="flex items-center gap-1.5 text-xs text-purple-400">
            <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse"></div>
            <span>Scanning Active</span>
          </div>
        </div>
      )}
    </div>
  );
}
