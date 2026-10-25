// Vercel serverless entry point. vercel.json rewrites every backend path (/api/*,
// /webhooks/*, legal pages) here; the static SPA in dist/ is served by Vercel directly.
import { createApp } from '../server';

export default createApp();
