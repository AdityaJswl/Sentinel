import './load-env.js';
import { databaseUrls } from './database-env.js';
import { z } from 'zod';

Object.assign(process.env, databaseUrls(process.env));
export const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    DIRECT_URL: z.string().min(1),
    PORT: z.coerce.number().default(3003),
    SIGNING_SECRET: z.string().min(32),
    REGISTRATION_API_KEY: z.string().min(32),
    VITE_SUPABASE_URL: z.string().url(),
    VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    CONSOLE_ORIGIN: z.string().default('http://127.0.0.1:5175,http://127.0.0.1:3003'),
    RAZORCART_ALLOWED_ORIGIN: z.string().default('http://127.0.0.1:5174'),
    RAZORCART_CATALOG_URL: z.string().url(),
    SENTINEL_CATALOG_KEY: z.string().min(32),
    PAYMENT_MODE: z.enum(['mock', 'test']).default('mock'),
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  })
  .parse(process.env);
