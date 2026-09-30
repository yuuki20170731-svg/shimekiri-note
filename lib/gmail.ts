/** Gmail のアクセストークンと本文はブラウザ内だけで扱い、アプリの保存先へ送らない。 */
export const GMAIL_READ_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export type GmailPreview = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
};

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};
type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: GmailPart;
};

function decodeBase64Url(data: string): string {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

export function decodeMimeHeader(value: string): string {
  return value
    .replace(/(\?=)[ \t]+(?==\?)/g, "$1")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (original, charset, mode, data) => {
        try {
          const bytes =
            mode.toLowerCase() === "b"
              ? Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
              : Uint8Array.from(
                  (data as string)
                    .replace(/_/g, " ")
                    .replace(/=([0-9a-f]{2})/gi, (_, hex) =>
                      String.fromCharCode(Number.parseInt(hex, 16)),
                    ),
                  (char) => char.charCodeAt(0),
                );
          return new TextDecoder(charset).decode(bytes);
        } catch {
          return original;
        }
      },
    );
}

function mailHeader(part: GmailPart | undefined, name: string): string {
  return decodeMimeHeader(
    part?.headers?.find((header) => header.name.toLowerCase() === name)
      ?.value ?? "",
  );
}

export function mailBody(part: GmailPart | undefined): string {
  if (!part) return "";
  const find = (item: GmailPart, mimeType: string): string | undefined => {
    if (item.mimeType === mimeType && item.body?.data) return item.body.data;
    for (const child of item.parts ?? []) {
      const result = find(child, mimeType);
      if (result) return result;
    }
    return undefined;
  };
  const plain = find(part, "text/plain");
  if (plain) return decodeBase64Url(plain);
  const htmlData = find(part, "text/html");
  if (htmlData) {
    const withLineBreaks = decodeBase64Url(htmlData)
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n");
    const html = new DOMParser().parseFromString(withLineBreaks, "text/html");
    html
      .querySelectorAll("script,style,noscript")
      .forEach((node) => node.remove());
    return html.body.textContent ?? "";
  }
  return "";
}

async function gmailRequest<T>(token: string, path: string): Promise<T> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (response.status === 401)
    throw new Error("Gmailとの接続が切れました。もう一度接続してください。");
  if (!response.ok)
    throw new Error(
      "Gmailを読み込めませんでした。接続と権限を確認してください。",
    );
  return (await response.json()) as T;
}

export async function gmailList(
  token: string,
  query: string,
): Promise<GmailPreview[]> {
  const params = new URLSearchParams({
    maxResults: "15",
    q: query || "in:inbox",
  });
  const result = await gmailRequest<{ messages?: { id: string }[] }>(
    token,
    `messages?${params}`,
  );
  const previews = await Promise.all(
    (result.messages ?? []).map(async ({ id }) => {
      const message = await gmailRequest<GmailMessage>(
        token,
        `messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      );
      return {
        id,
        subject: mailHeader(message.payload, "subject") || "（件名なし）",
        from: mailHeader(message.payload, "from") || "差出人不明",
        date: mailHeader(message.payload, "date"),
        snippet: message.snippet ?? "",
      };
    }),
  );
  return previews;
}

export async function gmailMessageText(
  token: string,
  id: string,
): Promise<string> {
  const message = await gmailRequest<GmailMessage>(
    token,
    `messages/${encodeURIComponent(id)}?format=full`,
  );
  const body = mailBody(message.payload);
  if (!body.trim())
    throw new Error(
      "このメールから本文を取り出せませんでした。本文をコピーして貼り付けてください。",
    );
  const text = `件名: ${mailHeader(message.payload, "subject")}\n差出人: ${mailHeader(message.payload, "from")}\n${body}`;
  if (text.length > 20000)
    throw new Error(
      "本文が長いため、そのまま読み取れません。必要な箇所をコピーして貼り付けてください。",
    );
  return text;
}
