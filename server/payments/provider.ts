export const DEMO_PAYMENT_METHODS = ['CARD_OK', 'CARD_DECLINES'] as const;
export type DemoPaymentMethod = (typeof DEMO_PAYMENT_METHODS)[number];

export interface ChargeRequest {
  customerId: string;
  amountCents: number;
  paymentMethod: DemoPaymentMethod;
  description: string;
  /** The provider returns the original result for a key it has already seen. */
  idempotencyKey: string;
}

export type ChargeResult =
  | { status: 'succeeded'; chargeId: string; amountCents: number }
  | { status: 'declined'; chargeId: string; declineCode: 'card_declined' };

/** A failure where the caller cannot know whether money moved. Safe to retry with the same key. */
export class TransientPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientPaymentError';
  }
}

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
