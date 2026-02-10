module.exports = {
    apps: [
        // ===========================
        // Frontend - Vite Production Build served by Express
        // ===========================
        {
            name: '360data-frontend',
            script: 'server.js',
            cwd: '/var/www/360data-bi',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                PORT: 8080
            },
            error_file: '/var/log/pm2/360data-frontend-error.log',
            out_file: '/var/log/pm2/360data-frontend-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 4000
        },

        // ===========================
        // Backend - Express API + Prisma
        // ===========================
        {
            name: '360data-backend',
            script: 'dist/index.js',
            cwd: '/var/www/360data-bi/backend',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                PORT: 3001
            },
            error_file: '/var/log/pm2/360data-backend-error.log',
            out_file: '/var/log/pm2/360data-backend-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 4000
        }
    ]
};
