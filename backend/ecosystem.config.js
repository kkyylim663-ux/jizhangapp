// pm2 进程配置：pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'jizhang-backend',
      script: 'server.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      // 崩溃自动重启 + 日志文件
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
