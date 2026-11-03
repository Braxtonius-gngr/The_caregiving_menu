// Connection details for the stack under test: env vars win, else the local
// `supabase start` stack. SERVICE_ROLE_KEY is only used to create test users.
const { execSync } = require('child_process');
const path = require('path');
module.exports = function env() {
  if (process.env.API_URL && process.env.ANON_KEY && process.env.SERVICE_ROLE_KEY) return { API_URL: process.env.API_URL, ANON_KEY: process.env.ANON_KEY, SERVICE_ROLE_KEY: process.env.SERVICE_ROLE_KEY, DB_URL: process.env.DB_URL };
  const out = execSync('npx -y supabase@2.54.11 status -o env', { cwd: path.join(__dirname, '../..') }).toString();
  const e = Object.fromEntries(out.trim().split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
  return { API_URL: e.API_URL, ANON_KEY: e.ANON_KEY, SERVICE_ROLE_KEY: e.SERVICE_ROLE_KEY, DB_URL: e.DB_URL };
};
