import React from 'react';
import { Layers } from 'lucide-react';

interface ZoneControlProps {
  upperZone: number | null;
  lowerZone: number | null;
  r1Zone: number | null;
  s1Zone: number | null;
  r2Zone: number | null;
  s2Zone: number | null;
  r3Zone: number | null;
  s3Zone: number | null;
  r4Zone: number | null;
  s4Zone: number | null;
  openPrice: number | null;
  onUpperZoneChange: (value: number | null) => void;
  onLowerZoneChange: (value: number | null) => void;
  onR1Change: (value: number | null) => void;
  onS1Change: (value: number | null) => void;
  onUpperZoneR2Change: (value: number | null) => void;
  onLowerZoneS2Change: (value: number | null) => void;
  onR3Change: (value: number | null) => void;
  onS3Change: (value: number | null) => void;
  onR4Change: (value: number | null) => void;
  onS4Change: (value: number | null) => void;
  onOpenPriceChange: (value: number | null) => void;
  onZoneSizesChange?: (sizes: {
    upper: number; lower: number;
    r1: number; s1: number;
    r2: number; s2: number;
    r3: number; s3: number;
    r4: number; s4: number;
  }) => void;
  currentZoneSizes?: {
    upper: number; lower: number;
    r1: number; s1: number;
    r2: number; s2: number;
    r3: number; s3: number;
    r4: number; s4: number;
  };
  className?: string;
}

// Size button component
const SizeButton = ({
  size,
  isActive,
  onClick,
  color
}: {
  size: number;
  isActive: boolean;
  onClick: () => void;
  color: 'red' | 'yellow' | 'green';
}) => {
  const colorStyles = {
    red: isActive
      ? 'bg-red-500/30 border-red-400 text-red-300 shadow-red-500/20 shadow-sm'
      : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:border-red-500/50 hover:text-red-400',
    yellow: isActive
      ? 'bg-yellow-500/30 border-yellow-400 text-yellow-300 shadow-yellow-500/20 shadow-sm'
      : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:border-yellow-500/50 hover:text-yellow-400',
    green: isActive
      ? 'bg-green-500/30 border-green-400 text-green-300 shadow-green-500/20 shadow-sm'
      : 'bg-gray-800/50 border-gray-700 text-gray-500 hover:border-green-500/50 hover:text-green-400'
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-7 h-6 rounded text-[10px] font-bold border transition-all duration-150 ${colorStyles[color]}`}
    >
      {size}
    </button>
  );
};

// Zone input component
const ZoneInput = ({
  label,
  value,
  onChange,
  color,
  zoneId,
  currentSize,
  onSizeChange,
  isBiasZone = false,
}: {
  label: string;
  value: number | null;
  onChange: (val: number | null) => void;
  color: 'red' | 'yellow' | 'green' | 'white';
  zoneId?: string;
  currentSize?: number;
  onSizeChange?: (size: number) => void;
  isBiasZone?: boolean; // For Upper/Lower zones that use 2/4/6 instead of 3/5/6
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;

    if (val === '' || val === '-') {
      onChange(null);
      return;
    }

    const num = parseFloat(val);
    if (!isNaN(num)) {
      onChange(num);
    }
  };

  const labelColors = {
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    green: 'text-green-400',
    white: 'text-gray-200'
  };

  const inputStyles = {
    red: 'border-red-500/20 focus:border-red-400 focus:ring-red-500/30 bg-red-950/20',
    yellow: 'border-yellow-500/20 focus:border-yellow-400 focus:ring-yellow-500/30 bg-yellow-950/20',
    green: 'border-green-500/20 focus:border-green-400 focus:ring-green-500/30 bg-green-950/20',
    white: 'border-gray-700 focus:border-gray-400 focus:ring-gray-500/30 bg-gray-900/50'
  };

  const accentBar = {
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
    white: 'bg-gray-400'
  };

  return (
    <div className="relative group">
      {/* Subtle left accent bar */}
      <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full ${accentBar[color]} opacity-50 group-hover:opacity-100 transition-opacity`}></div>

      <div className="pl-3 space-y-1">
        <div className="flex items-center justify-between">
          <label className={`text-[10px] font-semibold tracking-wide uppercase ${labelColors[color]}`}>
            {label}
          </label>
          {zoneId && onSizeChange && currentSize && color !== 'white' && (
            <div className="flex gap-0.5">
              {isBiasZone ? (
                <>
                  <SizeButton size={2} isActive={currentSize === 2} onClick={() => onSizeChange(2)} color={color} />
                  <SizeButton size={4} isActive={currentSize === 4} onClick={() => onSizeChange(4)} color={color} />
                  <SizeButton size={6} isActive={currentSize === 6} onClick={() => onSizeChange(6)} color={color} />
                </>
              ) : (
                <>
                  <SizeButton size={3} isActive={currentSize === 3} onClick={() => onSizeChange(3)} color={color} />
                  <SizeButton size={5} isActive={currentSize === 5} onClick={() => onSizeChange(5)} color={color} />
                  <SizeButton size={6} isActive={currentSize === 6} onClick={() => onSizeChange(6)} color={color} />
                </>
              )}
            </div>
          )}
        </div>
        <input
          type="number"
          value={value !== null ? value : ''}
          onChange={handleChange}
          step="1"
          className={`w-full border rounded-lg px-3 py-2 text-sm text-white font-medium
                     focus:outline-none focus:ring-1 transition-all duration-150 placeholder-gray-600
                     ${inputStyles[color]}`}
          placeholder="—"
        />
      </div>
    </div>
  );
};

export default function ZoneControl({
  upperZone, lowerZone,
  r1Zone, s1Zone,
  r2Zone, s2Zone,
  r3Zone, s3Zone,
  openPrice,
  onUpperZoneChange,
  onLowerZoneChange,
  onR1Change,
  onS1Change,
  onUpperZoneR2Change,
  onLowerZoneS2Change,
  onR3Change,
  onS3Change,
  onOpenPriceChange,
  onZoneSizesChange,
  currentZoneSizes = {
    upper: 6, lower: 6,
    r1: 6, s1: 6,
    r2: 6, s2: 6,
    r3: 6, s3: 6,
    r4: 6, s4: 6
  },
  className = ''
}: ZoneControlProps) {

  const handleSizeChange = (zone: keyof typeof currentZoneSizes, size: number) => {
    onZoneSizesChange?.({ ...currentZoneSizes, [zone]: size });
  };

  return (
    <div className={`rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-800/50">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
          <Layers className="w-4 h-4 text-blue-400" strokeWidth={2.5} />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight">Zone Control</h3>
          <p className="text-[10px] text-gray-500">Configure trading zones</p>
        </div>
      </div>

      {/* Scrollable Zone Inputs */}
      <div className="px-4 py-3 max-h-[calc(100vh-400px)] overflow-y-auto space-y-2.5 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">

        {/* Resistance Section */}
        <div className="pb-2">
          <div className="text-[9px] font-bold text-red-400/70 uppercase tracking-widest mb-2 px-3">Resistance</div>

          <ZoneInput
            label="R3"
            value={r3Zone}
            onChange={onR3Change}
            color="red"
            zoneId="r3"
            currentSize={currentZoneSizes.r3}
            onSizeChange={(s) => handleSizeChange('r3', s)}
          />

          <ZoneInput
            label="R2"
            value={r2Zone}
            onChange={onUpperZoneR2Change}
            color="red"
            zoneId="r2"
            currentSize={currentZoneSizes.r2}
            onSizeChange={(s) => handleSizeChange('r2', s)}
          />

          <ZoneInput
            label="R1"
            value={r1Zone}
            onChange={onR1Change}
            color="red"
            zoneId="r1"
            currentSize={currentZoneSizes.r1}
            onSizeChange={(s) => handleSizeChange('r1', s)}
          />
        </div>

        {/* Bias Section */}
        <div className="py-2 border-t border-gray-800/30">
          <div className="text-[9px] font-bold text-yellow-400/70 uppercase tracking-widest mb-2 px-3">Bias Zones</div>

          <ZoneInput
            label="Upper (Long Bias)"
            value={upperZone}
            onChange={onUpperZoneChange}
            color="yellow"
            zoneId="upper"
            currentSize={currentZoneSizes.upper}
            onSizeChange={(s) => handleSizeChange('upper', s)}
            isBiasZone={true}
          />

          {/* Open Price - Divider */}
          <div className="my-3 px-3">
            <div className="h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent"></div>
          </div>

          <ZoneInput
            label="Open Price"
            value={openPrice}
            onChange={onOpenPriceChange}
            color="white"
          />

          {/* Divider */}
          <div className="my-3 px-3">
            <div className="h-px bg-gradient-to-r from-transparent via-gray-700 to-transparent"></div>
          </div>

          <ZoneInput
            label="Lower (Short Bias)"
            value={lowerZone}
            onChange={onLowerZoneChange}
            color="yellow"
            zoneId="lower"
            currentSize={currentZoneSizes.lower}
            onSizeChange={(s) => handleSizeChange('lower', s)}
            isBiasZone={true}
          />
        </div>

        {/* Support Section */}
        <div className="pt-2 border-t border-gray-800/30">
          <div className="text-[9px] font-bold text-green-400/70 uppercase tracking-widest mb-2 px-3">Support</div>

          <ZoneInput
            label="S1"
            value={s1Zone}
            onChange={onS1Change}
            color="green"
            zoneId="s1"
            currentSize={currentZoneSizes.s1}
            onSizeChange={(s) => handleSizeChange('s1', s)}
          />

          <ZoneInput
            label="S2"
            value={s2Zone}
            onChange={onLowerZoneS2Change}
            color="green"
            zoneId="s2"
            currentSize={currentZoneSizes.s2}
            onSizeChange={(s) => handleSizeChange('s2', s)}
          />

          <ZoneInput
            label="S3"
            value={s3Zone}
            onChange={onS3Change}
            color="green"
            zoneId="s3"
            currentSize={currentZoneSizes.s3}
            onSizeChange={(s) => handleSizeChange('s3', s)}
          />
        </div>

      </div>
    </div>
  );
}
