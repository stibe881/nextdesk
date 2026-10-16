#!/usr/bin/env node

const appUrl = process.env.NEXTDESK_APP_URL ?? "https://app.nextdesk.ch/";
const supabaseUrl = process.env.NEXTDESK_SUPABASE_URL;
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function fetchOrRecord(url, options, label) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      failures.push(`${label}: HTTP ${response.status}`);
    }
    return response;
  } catch (error) {
    failures.push(
      `${label}: ${error instanceof Error ? error.message : "nicht erreichbar"}`,
    );
    return null;
  }
}

const appResponse = await fetchOrRecord(
  appUrl,
  { redirect: "error" },
  "Web-App",
);
if (appResponse) {
  const html = await appResponse.text();
  const assetMatch = html.match(
    /<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/u,
  );
  assert(
    assetMatch,
    "Web-App: kein produktives JavaScript-Bundle referenziert",
  );
  assert(
    !html.includes("Edge Function returned a non-2xx status code"),
    "Web-App: technische Edge-Function-Fehlermeldung im HTML gefunden",
  );

  if (assetMatch) {
    const assetUrl = new URL(assetMatch[1], appUrl).toString();
    await fetchOrRecord(assetUrl, { redirect: "error" }, "JavaScript-Bundle");
  }
}

if (supabaseUrl) {
  const functionUrl = new URL(
    "/functions/v1/tenant-audit-log",
    supabaseUrl,
  ).toString();
  const response = await fetchOrRecord(
    functionUrl,
    {
      method: "OPTIONS",
      headers: {
        Origin: new URL(appUrl).origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,apikey,content-type",
      },
    },
    "Audit-Function-CORS",
  );
  if (response) {
    assert(
      response.status === 204,
      `Audit-Function-CORS: erwarteter HTTP-Status 204, erhalten ${response.status}`,
    );
    assert(
      response.headers.get("access-control-allow-origin") ===
        new URL(appUrl).origin,
      "Audit-Function-CORS: erlaubte Origin stimmt nicht mit der Web-App überein",
    );
  }
}

if (failures.length > 0) {
  console.error("Release-Smoke-Test fehlgeschlagen:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Release-Smoke-Test erfolgreich.");
}
