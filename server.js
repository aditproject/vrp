const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const fetch = require('node-fetch');

const app = express();
const port = 3001;

// --- Konfigurasi Middleware ---
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({
    secret: 'kunci-rahasia-super-aman-ganti-ini-nanti',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }
}));

// --- Konfigurasi Database ---
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '17Agustus1945',
    database: 'whatsapp'
};
const pool = mysql.createPool(dbConfig);
const orsApiKey = '5b3ce3597851110001cf6248106a71c6bd3847d29b47a215f0d6e3af';

// --- Middleware ---
const checkAuth = (req, res, next) => {
    if (req.session && req.session.driver_id) {
        next();
    } else {
        res.status(401).json({ error: 'Akses ditolak. Silakan login.' });
    }
};

const checkAdmin = (req, res, next) => {
    if (req.session && req.session.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Akses ditolak. Hanya untuk admin.' });
    }
};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));


// --- API Endpoints ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password dibutuhkan.' });
    try {
        const [rows] = await pool.query('SELECT * FROM drivers WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Username atau password salah.' });
        
        const driver = rows[0];
        const match = await bcrypt.compare(password, driver.password);
        if (match) {
            req.session.driver_id = driver.id;
            req.session.driver_name = driver.driver_name;
            req.session.role = driver.role;
            res.json({ success: true, message: 'Login berhasil.', role: driver.role });
        } else {
            res.status(401).json({ error: 'Username atau password salah.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Terjadi kesalahan di server.' });
    }
});
app.get('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) { return res.status(500).json({ error: 'Gagal logout.' }); }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logout berhasil.' });
    });
});
app.get('/api/session', checkAuth, (req, res) => {
    res.json({
        driver_id: req.session.driver_id,
        driver_name: req.session.driver_name,
        role: req.session.role
    });
});
app.get('/api/shipments', checkAuth, async (req, res) => {
    const { date } = req.query;
    const driver_id = req.session.driver_id;
    if (!date) { return res.status(400).json({ error: 'Parameter tanggal dibutuhkan.' }); }
    try {
        const sql = `
            SELECT 
                l.*, d.driver_name, v.vehicle_name, v.capacity
            FROM locations l
            JOIN drivers d ON l.driver_id = d.id
            JOIN vehicles v ON v.driver_id = d.id
            WHERE l.delivery_date = ? AND l.driver_id = ? AND l.status = 'Pending' AND l.is_depot = 0
        `;
        const [shipments] = await pool.query(sql, [date, driver_id]);
        const [depotRows] = await pool.query("SELECT * FROM locations WHERE is_depot = 1 LIMIT 1");
        res.json({ shipments, depot: depotRows[0] || null });
    } catch (error) {
        console.error('Database error on fetching shipments:', error);
        res.status(500).json({ error: 'Gagal mengambil data pengiriman.' });
    }
});
app.post('/api/solve-vrp', checkAuth, async (req, res) => {
    const data = req.body;
    if (!data || !data.shipments || !data.depot) return res.status(400).json({ error: 'Data tidak lengkap.' });
    try {
        const solution = await solveVrpFromShipments(data);
        res.json(solution);
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghitung rute.', details: error.message });
    }
});
app.get('/api/get-drivers', checkAuth, checkAdmin, async (req, res) => {
    try {
        const [drivers] = await pool.query("SELECT id, driver_name FROM drivers WHERE role = 'driver' ORDER BY driver_name ASC");
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil daftar supir.' });
    }
});
app.get('/api/all-shipments', checkAuth, checkAdmin, async (req, res) => {
    const { date } = req.query;
    if (!date) { return res.status(400).json({ error: 'Parameter tanggal dibutuhkan.' }); }
    try {
        const sql = `
            SELECT 
                l.*, d.driver_name, v.vehicle_name, v.capacity
            FROM locations l
            JOIN drivers d ON l.driver_id = d.id
            JOIN vehicles v ON d.id = v.driver_id
            WHERE l.delivery_date = ? AND l.status = 'Pending' AND l.is_depot = 0
        `;
        const [shipments] = await pool.query(sql, [date]);
        const [depotRows] = await pool.query("SELECT * FROM locations WHERE is_depot = 1 LIMIT 1");
        res.json({ shipments, depot: depotRows[0] || null });
    } catch (error) {
        console.error('Database error on fetching all shipments:', error);
        res.status(500).json({ error: 'Gagal mengambil semua data.' });
    }
});
app.post('/api/solve-all-vrp', checkAuth, checkAdmin, async (req, res) => {
    const data = req.body;
    if (!data || !data.shipments || !data.depot) {
        return res.status(400).json({ error: 'Data tidak lengkap untuk optimasi.' });
    }
    try {
        const { shipments, depot } = data;
        const shipmentsByDriver = shipments.reduce((acc, shipment) => {
            (acc[shipment.driver_id] = acc[shipment.driver_id] || []).push(shipment);
            return acc;
        }, {});

        const allSolutionsPromises = Object.keys(shipmentsByDriver).map(driverId => {
            const singleDriverData = { depot, shipments: shipmentsByDriver[driverId] };
            return solveVrpFromShipments(singleDriverData);
        });

        const results = await Promise.all(allSolutionsPromises);
        const combinedRoutes = results.flatMap(solution => solution.routes);
        res.json({ routes: combinedRoutes });
    } catch (error) {
        console.error('Error saat VRP solving untuk semua supir:', error);
        res.status(500).json({ error: 'Gagal menghitung semua rute.', details: error.message });
    }
});

// --- Fungsi VRP & Helper ---

// Fungsi untuk mendapatkan matriks jarak & durasi dari ORS
async function getOrsDistanceMatrix(locations) {
    if (orsApiKey === 'GANTI_DENGAN_API_KEY_ANDA' || !orsApiKey) {
        throw new Error("API Key ORS di server.js belum diisi.");
    }
    const coordinates = locations.map(loc => [loc.lon, loc.lat]);
    try {
        const response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
            method: 'POST',
            headers: {
                'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
                'Content-Type': 'application/json',
                'Authorization': orsApiKey
            },
            body: JSON.stringify({ locations: coordinates, metrics: ["distance", "duration"] })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`ORS Matrix API Error: ${errorData.error.message}`);
        }
        const data = await response.json();
        return {
            distances: data.distances.map(row => row.map(d => d / 1000)), // Konversi ke KM
            durations: data.durations // Dalam detik
        };
    } catch (error) {
        console.error('Gagal mengambil matriks jarak dari ORS:', error);
        throw error;
    }
}

async function solveVrpFromShipments(data) {
    const { depot, shipments } = data;
    if (!depot) throw new Error('Data Gudang (Depot) tidak ditemukan.');
    
    // 1. Agregasi Customer
    const aggregatedCustomers = new Map();
    shipments.forEach(shipment => {
        const key = shipment.point_name;
        if (aggregatedCustomers.has(key)) {
            const existing = aggregatedCustomers.get(key);
            existing.demand += parseInt(shipment.demand);
            existing.sales_value = parseFloat(existing.sales_value) + parseFloat(shipment.sales_value);
        } else {
            const newEntry = { ...shipment };
            newEntry.demand = parseInt(newEntry.demand);
            newEntry.sales_value = parseFloat(newEntry.sales_value);
            aggregatedCustomers.set(key, newEntry);
        }
    });
    const uniqueCustomers = Array.from(aggregatedCustomers.values());

    // 2. Siapkan data untuk matriks dan optimasi
    const solution = { routes: [] };
    if (uniqueCustomers.length === 0) return solution;

    const allLocations = [depot, ...uniqueCustomers];
    const locationIndexMap = new Map(allLocations.map((loc, i) => [loc.id, i]));
    
    // 3. Panggil API Matriks SATU KALI
    const matrix = await getOrsDistanceMatrix(allLocations);
    if (!matrix) {
        throw new Error("Gagal mendapatkan data jarak dari OpenRouteService.");
    }
    const { distances, durations } = matrix;

    let customersToVisit = JSON.parse(JSON.stringify(uniqueCustomers));
    const driverInfo = customersToVisit[0];
    const vehicle = { capacity: driverInfo.capacity, vehicle_name: driverInfo.vehicle_name };
    const SERVICE_TIME_PER_STOP_SEC = 20 * 60;
    const MAX_WORK_DURATION_SEC = (20 - 9) * 3600;

    let tripCount = 1;
    while (customersToVisit.length > 0) {
        const route = {
            driver_id: driverInfo.driver_id,
            vehicle_name: `${driverInfo.driver_name} - ${vehicle.vehicle_name} (Trip ${tripCount})`,
            vehicle_capacity: vehicle.capacity,
            total_load: 0,
            total_distance: 0,
            total_sales: 0,
            path_stops: [depot],
            estimated_duration: 0
        };
        let currentCapacity = parseInt(vehicle.capacity);
        let currentLocationIndex = 0; // Index depot di matriks

        while (true) {
            let bestChoice = null;
            
            for (let i = 0; i < customersToVisit.length; i++) {
                const customer = customersToVisit[i];
                if (parseInt(customer.demand) <= currentCapacity) {
                    const customerMatrixIndex = locationIndexMap.get(customer.id);
                    if (customerMatrixIndex === undefined) continue;

                    const depotMatrixIndex = 0;

                    const durationToCustomer = durations[currentLocationIndex][customerMatrixIndex];
                    const durationToDepot = durations[customerMatrixIndex][depotMatrixIndex];
                    const potentialTotalTime = route.estimated_duration + durationToCustomer + SERVICE_TIME_PER_STOP_SEC + durationToDepot;
                    
                    if (potentialTotalTime <= MAX_WORK_DURATION_SEC) {
                        const distanceToCustomer = distances[currentLocationIndex][customerMatrixIndex];
                        if (bestChoice === null || distanceToCustomer < bestChoice.distance) {
                            bestChoice = { customer, index: i, distance: distanceToCustomer, duration: durationToCustomer };
                        }
                    }
                }
            }

            if (bestChoice) {
                const { customer, index, distance, duration } = bestChoice;
                route.total_load += parseInt(customer.demand);
                route.total_sales += parseFloat(customer.sales_value);
                route.total_distance += distance;
                route.estimated_duration += duration + SERVICE_TIME_PER_STOP_SEC;
                currentCapacity -= parseInt(customer.demand);
                route.path_stops.push(customer);
                currentLocationIndex = locationIndexMap.get(customer.id);
                customersToVisit = customersToVisit.filter(c => c.id !== customer.id);
            } else {
                break;
            }
        }

        if (route.path_stops.length > 1) { 
            const returnToDepotDuration = durations[currentLocationIndex][0];
            const returnToDepotDistance = distances[currentLocationIndex][0];
            route.estimated_duration += returnToDepotDuration;
            route.total_distance += returnToDepotDistance;
            route.path_stops.push(depot);
            
            // --- PERBAIKAN LOGIKA PRODUKTIVITAS GANDA DI SINI ---
            const analysis = {}; // Objek kosong untuk menampung dua analisis

            // Analisis #1: Waktu
            if (route.estimated_duration > MAX_WORK_DURATION_SEC) {
                 analysis.time = { 
                     status: 'Melebihi Waktu', 
                     message: 'Durasi perjalanan melebihi jam kerja maksimal.' 
                 };
            } else {
                analysis.time = {
                    status: 'Tepat Waktu',
                    message: 'Durasi perjalanan sesuai dengan jam kerja.'
                };
            }
            
            // Analisis #2: Penjualan
            const salesPerKm = route.total_sales / (route.total_distance || 1);
            const payloadEfficiency = route.total_load / route.vehicle_capacity;

            if (salesPerKm < 50000 && payloadEfficiency < 0.5) {
                analysis.sales = {
                    status: 'Tidak Efisien',
                    message: 'Biaya perjalanan mungkin lebih tinggi dari nilai penjualan.'
                };
            } else if (salesPerKm < 100000) {
                analysis.sales = {
                    status: 'Kurang Efisien',
                    message: 'Kepadatan penjualan per kilometer tergolong rendah.'
                };
            } else {
                analysis.sales = {
                    status: 'Efisien',
                    message: 'Rute ini efisien dari segi penjualan dan muatan.'
                };
            }

            route.analysis = analysis;
            solution.routes.push(route);
        }
        tripCount++;
    }
    return solution;
}

app.listen(port, () => {
    console.log(`Server VRP (Optimized Matrix) berjalan di http://localhost:${port}`);
});
