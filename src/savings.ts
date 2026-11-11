/** Invented Corner Crate fees, used by the savings calculator variant. */
export const NON_MEMBER_DELIVERY_FEE = 3.99;
export const SERVICE_FEE_SAVED_PER_ORDER = 1.25;
export const MONTHLY_PRICE = 9.99;

/** What a member saves in a month of `orders` orders, after paying for the membership. */
export function monthlySavings(orders: number): number {
  const saved = orders * (NON_MEMBER_DELIVERY_FEE + SERVICE_FEE_SAVED_PER_ORDER);
  return Math.round((saved - MONTHLY_PRICE) * 100) / 100;
}

/** The smallest number of orders a month at which membership pays for itself. */
export function breakEvenOrders(): number {
  return Math.ceil(MONTHLY_PRICE / (NON_MEMBER_DELIVERY_FEE + SERVICE_FEE_SAVED_PER_ORDER));
}
