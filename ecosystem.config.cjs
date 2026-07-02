module.exports = {
  apps: [
    {
      name: 'shoppable-blog-seo',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        SHOPIFY_BILLING_TEST: 'false',
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
    },
  ],
};
