# Shipping rules

1. `weightGrams` is measured in grams. Convert it to kilograms before choosing a weight tier: up to 1 kg costs $5, up to 5 kg costs $8, and anything heavier costs $20.
2. Free shipping applies only when `subtotal - coupon` is at least $75.
3. International shipping adds 12%. Round only the final shipping price to the nearest $0.50.

## Worked orders

- Order A: subtotal $80, coupon $10, weight 500 g, international. Correct shipping: $5.50.
- Order B: subtotal $70, no coupon, weight 500 g, international. Correct shipping: $5.50.
