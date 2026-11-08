<?php
/**
 * PRTG → nextDesk relay.
 *
 * Some networks block the Supabase domain (web filter, HTTPS inspection) for
 * the PRTG server. PRTG calls this file on the own domain instead; it passes
 * the notification on to the monitoring webhook unchanged.
 *
 * PRTG notification template (HTTP action, POST):
 *   URL:      https://app.nextdesk.ch/prtg-relay.php?token=<webhook token>
 *   Postdata: device=%device&host=%host&sensor=%sensor&status=%status&...
 *
 * No secret is stored here: the token comes from the request and is checked by
 * the webhook. The target is fixed, so this file cannot be used as an open
 * proxy.
 */
declare(strict_types=1);

const TARGET = 'https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/monitoring-webhook';
const MAX_BODY_BYTES = 16384;

function respond(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST' && $method !== 'GET') {
    header('Allow: GET, POST');
    respond(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

$token = trim((string) ($_GET['token'] ?? ($_SERVER['HTTP_X_NEXTDESK_TOKEN'] ?? '')));
if (!preg_match('/^[A-Za-z0-9_-]{32,128}$/', $token)) {
    respond(401, ['ok' => false, 'error' => 'unauthorized']);
}

$body = '';
if ($method === 'POST') {
    $body = (string) file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if (strlen($body) > MAX_BODY_BYTES) {
        respond(413, ['ok' => false, 'error' => 'payload_too_large']);
    }
}

$contentType = $_SERVER['CONTENT_TYPE'] ?? 'application/x-www-form-urlencoded';
$url = TARGET . '?' . http_build_query($_GET);
$headers = [
    'Content-Type: ' . $contentType,
    'User-Agent: nextdesk-prtg-relay/1.0',
    // The token may have arrived in the header only, so pass it on as well.
    'x-nextdesk-token: ' . $token,
];

if (function_exists('curl_init')) {
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 25,
    ]);
    if ($method === 'POST') {
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
    }
    $response = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
} else {
    $context = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'timeout' => 25,
            'ignore_errors' => true,
            'follow_location' => 0,
        ],
    ]);
    $response = @file_get_contents($url, false, $context);
    $status = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $match)) {
            $status = (int) $match[1];
        }
    }
}

if ($response === false || $status < 100) {
    respond(502, ['ok' => false, 'error' => 'relay_failed']);
}

http_response_code($status);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo $response;
