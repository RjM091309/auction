/**
 * PM2 dev stack — katumbas ng `npm run dev:all` (Vite + API).
 * Start: `pm2 start ecosystem.config.cjs`
 */
module.exports = {
  apps: [
    {
      name: 'auction-api',
      cwd: __dirname,
      script: 'server/src/index.js',
      interpreter: 'node',
      node_args: '--watch',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'auction-web',
      cwd: __dirname,
      script: './node_modules/vite/bin/vite.js',
      args: '--port=1011 --host=0.0.0.0',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
