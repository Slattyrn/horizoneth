import { useState } from "react";
import { TrendingUp, Eye, EyeOff } from "lucide-react";

interface VolumeConfirmationProps {
  onVolumeMultiplierChange: (multiplier: number) => void;
  onToggleEnabled: (enabled: boolean) => void;
  className?: string;
}

export default function VolumeConfirmation({
  onVolumeMultiplierChange,
  onToggleEnabled,
  className = ""
}: VolumeConfirmationProps) {
  const [volumeMultiplier, setVolumeMultiplier] = useState<number>(1.05);
  const [enabled, setEnabled] = useState<boolean>(true);

  const handleChange = (value: number) => {
    setVolumeMultiplier(value);
    onVolumeMultiplierChange(value);
  };

  const handleToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    onToggleEnabled(newEnabled);
  };

  return (
    <div className={`rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 p-2 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <TrendingUp className="text-green-500" size={14} />
          Volume Confirmation
        </h3>
        <button
          onClick={handleToggle}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all flex items-center gap-1 ${enabled
              ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
              : 'bg-gray-700/50 text-gray-400 border border-gray-600/30 hover:bg-gray-600/50'
            }`}
        >
          {enabled ? <Eye size={10} /> : <EyeOff size={10} />}
          {enabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className="space-y-1">
        {/* Volume Multiplier Slider */}
        <div>
          <label className="text-[10px] font-medium text-gray-300 mb-1 block flex items-center justify-between">
            <span>Multiplier</span>
            <span className="text-green-500 font-bold">{volumeMultiplier.toFixed(2)}x</span>
          </label>
          <input
            type="range"
            min="1.05"
            max="3.0"
            step="0.05"
            value={volumeMultiplier}
            onChange={(e) => handleChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-500
                     [&::-webkit-slider-thumb]:cursor-pointer hover:[&::-webkit-slider-thumb]:bg-green-400
                     [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-green-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
            <span>1.05x</span>
            <span>2.0x</span>
            <span>3.0x</span>
          </div>
        </div>

        {/* Info Box - Condensed */}
        <div className="text-[10px] text-gray-400 bg-gray-800/50 p-1.5 rounded border border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-green-500">●</span>
            <span>Min Vol:</span>
          </div>
          <span className="text-green-400 font-mono font-semibold">
            {(volumeMultiplier * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}
