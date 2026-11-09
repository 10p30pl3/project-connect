module.exports = {
  apps: [
    {
      name: 'voice-app',
      script: './index.js',
      instances: 1, // 1 instância mestre por porta SIP/RTP compartilhada
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true
    }
  ]
};
