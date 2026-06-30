<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=1800');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Méthode non autorisée']);
    exit;
}

$cacheFile = __DIR__ . '/reviews-cache.json';
$cacheTtlSeconds = 6 * 60 * 60;

function serve_cache_if_fresh(string $cacheFile, int $ttl): bool
{
    if (!is_file($cacheFile)) {
        return false;
    }
    $age = time() - (int) filemtime($cacheFile);
    if ($age > $ttl) {
        return false;
    }
    $cached = file_get_contents($cacheFile);
    if ($cached === false) {
        return false;
    }
    echo $cached;
    return true;
}

function serve_stale_cache_or_error(string $cacheFile, array $errorPayload, int $httpCode): void
{
    if (is_file($cacheFile)) {
        $cached = file_get_contents($cacheFile);
        if ($cached !== false) {
            echo $cached;
            return;
        }
    }
    http_response_code($httpCode);
    echo json_encode($errorPayload, JSON_UNESCAPED_UNICODE);
}

if (serve_cache_if_fresh($cacheFile, $cacheTtlSeconds)) {
    exit;
}

$apiKey = getenv('GOOGLE_PLACES_API_KEY') ?: '';
$placeId = getenv('GOOGLE_PLACE_ID') ?: '';

if ($apiKey === '' || $placeId === '') {
    serve_stale_cache_or_error($cacheFile, [
        'configured' => false,
        'error' => 'Avis Google non connectés'
    ], 503);
    exit;
}

$query = http_build_query([
    'place_id' => $placeId,
    'fields' => 'name,rating,user_ratings_total,reviews,url',
    'language' => 'fr',
    'key' => $apiKey,
]);

if (!function_exists('curl_init')) {
    serve_stale_cache_or_error($cacheFile, [
        'configured' => true,
        'error' => 'Avis Google momentanément indisponibles'
    ], 500);
    exit;
}

$ch = curl_init('https://maps.googleapis.com/maps/api/place/details/json?' . $query);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_FAILONERROR => false,
]);

$rawResponse = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($rawResponse === false || $httpCode < 200 || $httpCode >= 300) {
    serve_stale_cache_or_error($cacheFile, [
        'configured' => true,
        'error' => 'Avis Google momentanément indisponibles'
    ], 502);
    exit;
}

$data = json_decode($rawResponse, true);
if (!is_array($data) || ($data['status'] ?? '') !== 'OK') {
    serve_stale_cache_or_error($cacheFile, [
        'configured' => true,
        'error' => 'Avis Google momentanément indisponibles'
    ], 502);
    exit;
}

$result = $data['result'] ?? [];
$reviews = array_slice($result['reviews'] ?? [], 0, 5);

function truncate_review_text(string $text, int $limit = 420): string
{
    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
        return mb_strlen($text) > $limit ? mb_substr($text, 0, $limit - 3) . '...' : $text;
    }

    return strlen($text) > $limit ? substr($text, 0, $limit - 3) . '...' : $text;
}

$cleanReviews = array_map(static function (array $review): array {
    $text = truncate_review_text(trim((string) ($review['text'] ?? '')));

    return [
        'author' => (string) ($review['author_name'] ?? 'Voyageur Google'),
        'rating' => (float) ($review['rating'] ?? 0),
        'time' => (string) ($review['relative_time_description'] ?? ''),
        'text' => $text,
    ];
}, $reviews);

$payload = json_encode([
    'configured' => true,
    'name' => (string) ($result['name'] ?? 'Le Cabanon d\'Aix'),
    'rating' => (float) ($result['rating'] ?? 0),
    'userRatingsTotal' => (int) ($result['user_ratings_total'] ?? 0),
    'url' => (string) ($result['url'] ?? 'https://maps.app.goo.gl/vZbrScfnDje7xfWY9'),
    'reviews' => $cleanReviews,
], JSON_UNESCAPED_UNICODE);

if ($payload !== false) {
    @file_put_contents($cacheFile, $payload);
}

echo $payload;
