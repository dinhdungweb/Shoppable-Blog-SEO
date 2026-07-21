module.exports = {
  apps: [
    {
      name: 'shoppable-blog-seo',
      script: 'npm',
      // Deploy pending Prisma migrations before accepting traffic.
      args: 'run docker-start',
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        SHOPIFY_BILLING_TEST: 'false',
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
    },
    {
      name: 'shoppable-blog-seo-worker',
      script: 'npm',
      args: 'run seo:worker',
      autorestart: true,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        SHOPIFY_BILLING_TEST: 'false',
        SEO_WORKER_URL: 'http://127.0.0.1:3004/app/seo',
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
    },
  ],
};
