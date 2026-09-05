# RazorCart + Sentinel

An agentic-commerce demo built for the Razorpay AI Buildathon.

- **RazorCart** is the AI-powered storefront and buying agent. It uses Groq to understand shopping requests, rank real catalog products, and generate grounded recommendations.
- **Sentinel** is the independent authorization layer. It checks signed purchase proposals against per-agent budgets, category and merchant permissions, expiry, frequency, price integrity, and replay protection before returning `APPROVE`, `DENY`, or `ESCALATE`.

## Live demo

- RazorCart: https://razorcart.vercel.app
- Sentinel: https://sentinel-sentinel-a860.vercel.app

Each project contains its own setup and architecture documentation. Environment files and credentials are intentionally excluded from this repository; use the included `.env.example` files for local configuration.
