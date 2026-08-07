function shipping({ subtotal, coupon, weightGrams, international }) {
  if (subtotal >= 75) return 0;

  let base;
  if (weightGrams > 5) {
    base = 20;
  } else if (weightGrams > 1) {
    base = 8;
  } else {
    base = 5;
  }

  if (international) {
    base = Math.round(base * 1.12);
  }

  return base;
}

const orders = [
  { name: "A", subtotal: 80, coupon: 10, weightGrams: 500, international: true },
  { name: "B", subtotal: 70, coupon: 0, weightGrams: 500, international: true },
];

for (const order of orders) {
  console.log(`Order ${order.name}: $${shipping(order).toFixed(2)}`);
}
