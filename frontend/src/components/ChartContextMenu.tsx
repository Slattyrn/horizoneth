import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrendingUp, TrendingDown, MousePointer2, Target, ZoomOut, X, Layers, RefreshCw } from 'lucide-react';
import { useTicker } from '../contexts/TickerContext';
import { snapToTick } from '../utils/snapToTick';

type ContextAction =
    | 'buy_market'
    | 'sell_market'
    | 'buy_stop'
    | 'sell_stop'
    | 'buy_limit'
    | 'sell_limit';

interface ChartContextMenuProps {
    x: number;
    y: number;
    price: number;
    currentPrice?: number;
    onClose: () => void;
    onAction: (action: ContextAction, price: number) => void;
    onResetZoom: () => void;
    onCancelAll?: () => void;
    onFVGEntry?: (price: number, side: 'long' | 'short', mode: 'fvg' | 'reclaim') => void;
}

export default function ChartContextMenu({ x, y, price, currentPrice, onClose, onAction, onResetZoom, onCancelAll, onFVGEntry }: ChartContextMenuProps) {
    const { activeConfig } = useTicker();
    const { tickSize, priceDecimals } = activeConfig;

    const menuRef = useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = useState(false);
    const [editedPrice, setEditedPrice] = useState(snapToTick(price, tickSize).toFixed(priceDecimals));
    const [isEditing, setIsEditing] = useState(false);

    // Snap to the active ticker's tick grid (MYM 1.0 / MES 0.25)
    const parsedPrice = snapToTick(parseFloat(editedPrice) || price, tickSize);

    // 🚨 Directional visibility — hide invalid sides so the UI can't be misread
    //   Buy Stop   → only visible ABOVE current price
    //   Sell Stop  → only visible BELOW current price
    //   Buy Limit  → only visible BELOW current price
    //   Sell Limit → only visible ABOVE current price
    const hasMkt = currentPrice !== undefined;
    const above = hasMkt && parsedPrice > (currentPrice as number);
    const below = hasMkt && parsedPrice < (currentPrice as number);
    const showBuyStop = !hasMkt || above;
    const showSellStop = !hasMkt || below;
    const showBuyLimit = !hasMkt || below;
    const showSellLimit = !hasMkt || above;

    useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        // Small delay to prevent initial click from closing immediately
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
        }, 50);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    if (!mounted) return null;

    // Portal to body to ensure visibility
    return createPortal(
        <div
            ref={menuRef}
            className="fixed z-[99999] w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-gray-200 text-xs overflow-hidden flex flex-col font-sans"
            style={{ top: Math.min(y, window.innerHeight - 280), left: Math.min(x, window.innerWidth - 200) }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="px-3 py-2 border-b border-gray-800 bg-gray-800/90">
                <div className="flex justify-between items-center gap-3">
                    <div className="flex flex-col gap-0.5 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] text-gray-500 uppercase">Price:</span>
                            {isEditing ? (
                                <input
                                    type="text"
                                    value={editedPrice}
                                    onChange={(e) => setEditedPrice(e.target.value)}
                                    onBlur={() => setIsEditing(false)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') setIsEditing(false);
                                        if (e.key === 'Escape') { setEditedPrice(snapToTick(price, tickSize).toFixed(priceDecimals)); setIsEditing(false); }
                                    }}
                                    autoFocus
                                    className="font-mono text-[10px] text-blue-400 font-bold bg-gray-700 border border-blue-500 rounded px-1.5 py-0.5 w-16 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            ) : (
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="font-mono text-[10px] text-blue-400 font-bold hover:bg-gray-700 px-1.5 py-0.5 rounded transition-colors"
                                    title="Click to edit price"
                                >
                                    ${parsedPrice.toFixed(priceDecimals)}
                                </button>
                            )}
                        </div>
                        {currentPrice !== undefined && (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-gray-500 uppercase">Mkt:</span>
                                <span className="font-mono text-[10px] text-green-400 font-bold">${snapToTick(currentPrice, tickSize).toFixed(priceDecimals)}</span>
                            </div>
                        )}
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={12} /></button>
                </div>
            </div>
            <div className="py-0.5 flex flex-col bg-gray-900">
                <button onClick={() => { onAction('buy_market', parsedPrice); onClose(); }} className="w-full px-3 py-1.5 text-left hover:bg-blue-900/20 hover:text-blue-400 flex items-center gap-2">
                    <TrendingUp size={14} /> Buy Market
                </button>
                <button onClick={() => { onAction('sell_market', parsedPrice); onClose(); }} className="w-full px-3 py-1.5 text-left hover:bg-red-900/20 hover:text-red-400 flex items-center gap-2">
                    <TrendingDown size={14} /> Sell Market
                </button>
                <div className="h-px bg-gray-800 my-0.5 mx-3" />
                {showBuyStop && (
                    <button
                        onClick={() => { onAction('buy_stop', parsedPrice); onClose(); }}
                        className="w-full px-3 py-1.5 text-left hover:bg-blue-900/20 hover:text-blue-400 flex items-center gap-2 text-gray-300"
                    >
                        <MousePointer2 size={14} /> Buy Stop
                    </button>
                )}
                {showSellStop && (
                    <button
                        onClick={() => { onAction('sell_stop', parsedPrice); onClose(); }}
                        className="w-full px-3 py-1.5 text-left hover:bg-red-900/20 hover:text-red-400 flex items-center gap-2 text-gray-300"
                    >
                        <MousePointer2 size={14} /> Sell Stop
                    </button>
                )}
                {showBuyLimit && (
                    <button
                        onClick={() => { onAction('buy_limit', parsedPrice); onClose(); }}
                        className="w-full px-3 py-1.5 text-left hover:bg-blue-900/20 hover:text-blue-400 flex items-center gap-2 text-gray-300"
                    >
                        <Target size={14} /> Buy Limit
                    </button>
                )}
                {showSellLimit && (
                    <button
                        onClick={() => { onAction('sell_limit', parsedPrice); onClose(); }}
                        className="w-full px-3 py-1.5 text-left hover:bg-red-900/20 hover:text-red-400 flex items-center gap-2 text-gray-300"
                    >
                        <Target size={14} /> Sell Limit
                    </button>
                )}
                <div className="h-px bg-gray-800 my-0.5 mx-3" />
                <button onClick={() => { onResetZoom(); onClose(); }} className="w-full px-3 py-1.5 text-left hover:bg-gray-800 flex items-center gap-2 text-gray-400">
                    <ZoomOut size={14} /> Reset Zoom
                </button>
                {onCancelAll && (
                    <>
                        <div className="h-px bg-gray-800 my-0.5 mx-3" />
                        <button onClick={() => { onCancelAll(); onClose(); }} className="w-full px-3 py-1.5 text-left hover:bg-red-900/30 hover:text-red-400 flex items-center gap-2 text-red-500 font-medium">
                            <X size={14} /> Cancel All
                        </button>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
