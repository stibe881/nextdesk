# OAuth-Vermittler (oauth-proxy)

Vermittelt zwischen Programmen ohne PKCE (zum Beispiel den Connectors von Gemini
Enterprise) und dem OAuth-Server von Supabase, der PKCE immer verlangt.

Adressen (Projekt-URL einsetzen):

- Autorisierung: `https://<ref>.supabase.co/functions/v1/oauth-proxy/authorize`
- Token: `https://<ref>.supabase.co/functions/v1/oauth-proxy/token`
- Rückkehr von Supabase: `https://<ref>.supabase.co/functions/v1/oauth-proxy/callback`

Secrets (Supabase → Edge Functions → Secrets):

| Name | Inhalt |
| --- | --- |
| `OAUTH_PROXY_CLIENT_ID` | frei gewählte ID, die das Programm (Gemini) verwendet |
| `OAUTH_PROXY_CLIENT_SECRET` | zufälliges Geheimnis, mindestens 32 Zeichen |
| `OAUTH_PROXY_UPSTREAM_CLIENT_ID` | Client-ID des vertraulichen Supabase-OAuth-Clients |
| `OAUTH_PROXY_UPSTREAM_CLIENT_SECRET` | Geheimnis dieses Supabase-Clients |
| `OAUTH_PROXY_ENC_KEY` | 32 zufällige Bytes, base64 |
| `OAUTH_PROXY_ALLOWED_REDIRECTS` | optional, kommagetrennt (Standard: Google-Weiterleitung) |

Der Supabase-Client muss als Redirect-URI die Adresse `/callback` eingetragen haben.
Ohne vollständige Secrets antwortet die Funktion mit 503.
