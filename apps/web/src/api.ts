export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body as T;
}

export async function readNdjson(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void | Promise<void>,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server returned an empty stream.");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) await onEvent(JSON.parse(line) as Record<string, unknown>);
      index = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) await onEvent(JSON.parse(buffer) as Record<string, unknown>);
}
