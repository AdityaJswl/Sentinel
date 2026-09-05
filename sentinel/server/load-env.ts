import dotenv from 'dotenv';

// Existing process variables (including Vercel secrets) take precedence.
dotenv.config({ path: '.env.local' });
dotenv.config();
