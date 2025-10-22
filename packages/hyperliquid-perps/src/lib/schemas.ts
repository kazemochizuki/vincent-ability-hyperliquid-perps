import { z } from 'zod';

export const KNOWN_ERRORS = {
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT', // Here for example purposes
} as const;

/**
 * Tool parameters schema - defines the input parameters for the native send tool
 */
export const abilityParamsSchema = z.object({
  coin: z.string(),
  side: z.enum(['buy', 'sell']),
  amount: z
    .string()
    .regex(/^\d*\.?\d+$/, 'Invalid amount format')
    .refine((val) => parseFloat(val) > 0, 'Amount must be greater than 0'),
  leverage: z
    .string()
    .regex(/^[1-9]\d*$/, 'Leverage must be a positive integer string (e.g., "1", "20")'),
  delegateePrivateKey: z.string(),
});

/**
 * Precheck success result schema
 */
export const precheckSuccessSchema = z.object({
  withdrawableUSDC: z.number().nonnegative(),
});

/**
 * Precheck failure result schema
 */
export const precheckFailSchema = z.object({
  error: z.string(),
});

/**
 * Execute success result schema
 */
export const executeSuccessSchema = z.object({
  result: z.string(),
});

/**
 * Execute failure result schema
 */
export const executeFailSchema = z.object({
  error: z.string(),
});

// Type exports
export type AbilityParams = z.infer<typeof abilityParamsSchema>;
export type PrecheckSuccess = z.infer<typeof precheckSuccessSchema>;
export type PrecheckFail = z.infer<typeof precheckFailSchema>;
export type ExecuteSuccess = z.infer<typeof executeSuccessSchema>;
export type ExecuteFail = z.infer<typeof executeFailSchema>;
