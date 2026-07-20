/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SHOPIFY_APP_URL: string;
    DATABASE_URL: string;
    GOOGLE_SEARCH_CONSOLE_CLIENT_ID?: string;
    GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET?: string;
    GOOGLE_SEARCH_CONSOLE_REDIRECT_URI?: string;
    GOOGLE_TOKEN_ENCRYPTION_KEY?: string;
  }
}
