// PM2 ecosystem — NutriChefIA
// Un solo proceso: Express sirve la API (/api), el frontend estatico (public/)
// y los archivos subidos (/uploads).
//
// Uso en el servidor (primera vez):
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup
//
// Los deploys posteriores usan "pm2 restart nutrichefia --update-env".

module.exports = {
  apps: [
    {
      name: 'nutrichefia',
      cwd: '/var/www/nutrichefia',
      script: 'src/server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 4005,
      },
    },
  ],
};
