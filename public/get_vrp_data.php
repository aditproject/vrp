<?php
// Atur header untuk output JSON dan CORS (untuk development)
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// --- Konfigurasi Database ---
$host = '172.17.0.1';
$dbname = 'whatsapp';
$user = 'root';
$port = 3306;
$password = '17Agustus1945';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $user, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Koneksi database gagal: ' . $e->getMessage()]);
    exit();
}

// Ambil tanggal dari parameter GET, jika tidak ada, gunakan tanggal hari ini
$delivery_date = isset($_GET['date']) ? $_GET['date'] : date('Y-m-d');

try {
    // Query untuk mengambil data pengiriman untuk tanggal yang dipilih
    $sql = "
        SELECT 
            s.id as shipment_id, s.delivery_date, s.demand, s.sales_value,
            l.*, 
            d.id as driver_id, d.driver_name,
            v.id as vehicle_id, v.vehicle_name, v.capacity
        FROM shipments s
        JOIN locations l ON s.location_id = l.id
        JOIN drivers d ON s.driver_id = d.id
        JOIN vehicles v ON v.driver_id = d.id
        WHERE s.delivery_date = ? AND s.status = 'Pending'
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$delivery_date]);
    $shipments_data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Ambil data depot
    $depot_stmt = $pdo->query("SELECT * FROM locations WHERE is_depot = 1 LIMIT 1");
    $depot = $depot_stmt->fetch(PDO::FETCH_ASSOC);

    // BARU: Ambil semua data supir untuk dropdown filter
    $drivers_stmt = $pdo->query("SELECT * FROM drivers ORDER BY driver_name ASC");
    $drivers = $drivers_stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'shipments' => $shipments_data,
        'depot' => $depot,
        'drivers' => $drivers // Kirim daftar supir ke frontend
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Gagal mengambil data: ' . $e->getMessage()]);
}
?>
