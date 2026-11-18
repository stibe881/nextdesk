/**
 * MCP App (Gemini Enterprise, ChatGPT u. a.): Formular «Ticket erstellen».
 *
 * Das Formular ist eine einzelne, in sich geschlossene HTML-Seite ohne externe
 * Quellen. Sie läuft in einem Rahmen des KI-Clients und spricht über
 * postMessage (JSON-RPC, MCP Apps, Version 2026-01-26) mit ihm:
 *   ui/initialize → ui/notifications/initialized → ui/notifications/tool-input
 *   (Vorbelegung) → tools/call «ticket_fuer_mich_erfassen» beim Absenden.
 * Der Klick auf «Ticket erstellen» ist die ausdrückliche Bestätigung
 * (bestaetigt=true). Die anfragende Person ist immer die angemeldete Person.
 */
export const TICKET_FORM_URI = "ui://nextdesk/ticket-formular";
export const TICKET_FORM_MIME = "text/html;profile=mcp-app";

export const TICKET_FORM_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket erstellen</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --text: #1f2a44; --muted: #5b6780; --border: #c9d1e0; --primary: #4338ca; --on-primary: #ffffff; --danger: #b42335; --ok: #11664e; --field: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1f2a; --text: #e8ecf5; --muted: #a4aec4; --border: #3a4256; --primary: #8da2f0; --on-primary: #101426; --danger: #ff8a98; --ok: #6fd3b0; --field: #222836; } }
  :root[data-theme="light"] { --bg: #ffffff; --text: #1f2a44; --muted: #5b6780; --border: #c9d1e0; --primary: #4338ca; --on-primary: #ffffff; --danger: #b42335; --ok: #11664e; --field: #ffffff; }
  :root[data-theme="dark"] { --bg: #1b1f2a; --text: #e8ecf5; --muted: #a4aec4; --border: #3a4256; --primary: #8da2f0; --on-primary: #101426; --danger: #ff8a98; --ok: #6fd3b0; --field: #222836; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); background: var(--bg); }
  h1 { margin: 0 0 12px; font-size: 16px; }
  label { display: grid; gap: 6px; margin-bottom: 12px; font-weight: 600; }
  label small { color: var(--muted); font-weight: 400; }
  input, textarea { width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--field); color: var(--text); font: inherit; }
  textarea { min-height: 110px; resize: vertical; }
  input:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
  button { padding: 9px 18px; border: 0; border-radius: 8px; background: var(--primary); color: var(--on-primary); font: inherit; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  .note { margin: 10px 0 0; color: var(--muted); font-size: 12px; }
  .error { margin: 10px 0 0; color: var(--danger); }
  .done { padding: 14px; border: 1px solid var(--border); border-radius: 10px; }
  .done strong { color: var(--ok); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<form id="form" novalidate>
  <h1>Ticket erstellen</h1>
  <label>Betreff
    <input id="betreff" name="betreff" maxlength="240" placeholder="Worum geht es?" required autocomplete="off">
  </label>
  <label>Beschreibung
    <textarea id="beschreibung" name="beschreibung" maxlength="8000" placeholder="Was ist passiert, seit wann, welche Fehlermeldung?"></textarea>
  </label>
  <label>Betroffenes Gerät <small>(optional)</small>
    <input id="geraet" name="geraet" maxlength="200" placeholder="z. B. iPhone, Samsung Galaxy, NB001" autocomplete="off">
  </label>
  <div class="actions">
    <button id="send" type="submit">Ticket erstellen</button>
  </div>
  <p class="note">Das Ticket wird für die angemeldete Person erfasst.</p>
  <p id="error" class="error" role="alert" hidden></p>
</form>
<div id="done" class="done" role="status" hidden></div>
<script>
(function () {
  var nextId = 1;
  var pending = {};
  var form = document.getElementById("form");
  var send = document.getElementById("send");
  var errorBox = document.getElementById("error");
  var doneBox = document.getElementById("done");
  var fields = {
    betreff: document.getElementById("betreff"),
    beschreibung: document.getElementById("beschreibung"),
    geraet: document.getElementById("geraet")
  };
  var workspace = null;
  var userEdited = false;

  function post(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params });
    });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  var lastHeight = 0;
  function reportSize() {
    // Höhe des Inhalts (nicht des Rahmens), sonst schaukelt sich die Grösse auf.
    var height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height === lastHeight) return;
    lastHeight = height;
    notify("ui/notifications/size-changed", {
      width: Math.ceil(document.body.getBoundingClientRect().width),
      height: height
    });
  }
  function prefill(data) {
    if (!data || userEdited) return;
    if (typeof data.betreff === "string" && data.betreff) fields.betreff.value = data.betreff;
    if (typeof data.beschreibung === "string" && data.beschreibung) fields.beschreibung.value = data.beschreibung;
    if (typeof data.geraet === "string" && data.geraet) fields.geraet.value = data.geraet;
    if (typeof data.arbeitsbereich === "string" && data.arbeitsbereich) workspace = data.arbeitsbereich;
    reportSize();
  }
  function showError(text) { errorBox.textContent = text; errorBox.hidden = !text; reportSize(); }

  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && pending[m.id] && (m.result !== undefined || m.error !== undefined)) {
      var entry = pending[m.id];
      delete pending[m.id];
      if (m.error) entry.reject(m.error); else entry.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-input") {
      prefill(m.params && m.params.arguments);
    } else if (m.method === "ui/notifications/tool-result") {
      var result = m.params || {};
      prefill(result.structuredContent);
    } else if (m.method === "ui/notifications/host-context-changed") {
      applyTheme(m.params);
    }
  });

  function applyTheme(context) {
    var theme = context && context.theme;
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  }

  Array.prototype.forEach.call(Object.keys(fields), function (key) {
    fields[key].addEventListener("input", function () { userEdited = true; });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    showError("");
    var betreff = fields.betreff.value.trim();
    if (betreff.length < 3) { showError("Bitte einen Betreff mit mindestens 3 Zeichen eingeben."); fields.betreff.focus(); return; }
    send.disabled = true;
    send.textContent = "Wird erstellt …";
    var args = { betreff: betreff, bestaetigt: true };
    var beschreibung = fields.beschreibung.value.trim();
    var geraet = fields.geraet.value.trim();
    if (beschreibung) args.beschreibung = beschreibung;
    if (geraet) args.geraet = geraet;
    if (workspace) args.arbeitsbereich = workspace;
    request("tools/call", { name: "ticket_fuer_mich_erfassen", arguments: args }).then(function (result) {
      var text = "";
      if (result && Array.isArray(result.content) && result.content[0]) text = String(result.content[0].text || "");
      if (result && result.isError) { throw { message: text || "Das Ticket konnte nicht erstellt werden." }; }
      var number = null;
      try { var parsed = JSON.parse(text); number = parsed.nummer || parsed.number || null; } catch (e) {}
      form.hidden = true;
      doneBox.hidden = false;
      doneBox.innerHTML = "";
      var strong = document.createElement("strong");
      strong.textContent = number ? "Ticket " + number + " wurde erstellt." : "Das Ticket wurde erstellt.";
      var rest = document.createElement("div");
      rest.textContent = "Die IT meldet sich.";
      doneBox.appendChild(strong);
      doneBox.appendChild(rest);
      reportSize();
    }).catch(function (error) {
      send.disabled = false;
      send.textContent = "Ticket erstellen";
      showError((error && error.message) ? String(error.message) : "Das Ticket konnte nicht erstellt werden. Bitte erneut versuchen.");
    });
  });

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appCapabilities: { availableDisplayModes: ["inline"] },
    clientInfo: { name: "nextDesk Ticket-Formular", version: "1.0.0" }
  }).then(function (result) {
    applyTheme(result && result.hostContext);
    notify("ui/notifications/initialized");
    reportSize();
  }).catch(function () {
    notify("ui/notifications/initialized");
  });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(reportSize).observe(document.body);
})();
</script>
</body>
</html>`;
