import { useEffect } from 'react';

/**
 * Custom hook to dynamically update browser tab title with ticker and price
 * Example: "ES 5950.25" or "MES 5950.25"
 */
export function useDynamicTitle(ticker: 'GC' | null, price: number | null, openPrice: number | null) {
    useEffect(() => {
        if (!ticker) {
            document.title = 'Horizon Alpha Terminal';
            return;
        }

        if (price !== null && !isNaN(price)) {
            // Format price with 2 decimals
            const formattedPrice = price.toFixed(2);

            let title = `${ticker} $${formattedPrice}`;

            if (openPrice !== null && !isNaN(openPrice) && openPrice !== 0) {
                const change = price - openPrice;
                const percentChange = (change / openPrice) * 100;
                const formattedPercent = Math.abs(percentChange).toFixed(2);

                if (change > 0) {
                    title += ` ↑ +${formattedPercent}%`;
                } else if (change < 0) {
                    title += ` ↓ -${formattedPercent}%`;
                } else {
                    title += ` → 0.00%`;
                }
                console.log(`✅ Browser tab updated: "${title}" | openPrice: ${openPrice}`);
            } else {
                console.log(`⚠️ No arrow - openPrice is: ${openPrice} (price: ${price})`);
            }

            document.title = title;
        } else {
            // Fallback if price not available
            document.title = `${ticker} - HAT`;
        }
    }, [ticker, price, openPrice]);
}
