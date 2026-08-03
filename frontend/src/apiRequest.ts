export function withJsonRequestDefaults(options: RequestInit = {}): RequestInit {
  const { headers: suppliedHeaders, ...requestOptions } = options;
  const headers = new Headers(suppliedHeaders);
  if (typeof requestOptions.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return {
    ...requestOptions,
    credentials: 'include',
    headers,
  };
}
