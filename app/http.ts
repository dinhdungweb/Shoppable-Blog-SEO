/**
 * JSON responses for resource routes (APIs, webhooks, fetcher endpoints):
 * always a real `application/json` Response, so storefront scripts, workers
 * and fetchers receive plain JSON. Routes with a UI use React Router's
 * `data()` instead (imported as `json` there).
 */
export function json<T>(body: T, init?: number | ResponseInit): Response {
  return Response.json(body, typeof init === "number" ? { status: init } : init);
}
