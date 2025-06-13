const express = require('express');
const cors = require('cors');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.post('/api/solve-vrp', (req, res) => {
    console.log('Menerima permintaan VRP dengan Logika Analisa Final...');
    const data = req.body;

    if (!data || !data.shipments || !data.depot) {
        return res.status(400).json({ error: 'Data yang dikirim tidak lengkap.' });
    }

    try {
        const solution = solveVrpWithFullAnalysis(data);
        console.log('Solusi VRP (Analisa Final) berhasil dibuat.');
        res.json(solution);
    } catch (error) {
        console.error('Error saat menjalankan solver:', error);
        res.status(500).json({ error: 'Terjadi kesalahan di server.', details: error.message });
    }
});


function solveVrpWithFullAnalysis(data) {
    const { depot, shipments } = data;

    if (!depot) {
        throw new Error('Data Gudang (Depot) tidak ditemukan.');
    }

    // --- ANALISA AWAL PER PENGIRIMAN ---
    shipments.forEach(shipment => {
        const sales = parseFloat(shipment.sales_value);
        const demand = parseInt(shipment.demand);
        const HIGH_SALES_THRESHOLD = 5000000; // Rp 5 Juta
        const LOW_SALES_THRESHOLD = 750000;   // Rp 750 Ribu
        
        shipment.analysis = null; // Default

        if (sales >= HIGH_SALES_THRESHOLD) {
            shipment.analysis = {
                status: 'Outlet Bintang 5',
                icon: '💎',
                message: 'Outlet dengan nilai penjualan sangat tinggi.'
            };
        } else if (sales <= LOW_SALES_THRESHOLD) {
            const distanceFromDepot = haversineDistance(depot, shipment);
            if (distanceFromDepot > 40) { // Jika jaraknya lebih dari 40km
                 shipment.analysis = {
                    status: 'Perlu Tinjauan',
                    icon: '⚠️',
                    message: 'Nilai penjualan rendah & lokasi jauh.'
                };
            }
        }
    });

    const solution = { routes: [], unserved_locations: [] };

    // --- Kelompokkan pengiriman berdasarkan supir ---
    const shipmentsByDriver = shipments.reduce((acc, shipment) => {
        const driverId = shipment.driver_id;
        if (!acc[driverId]) {
            acc[driverId] = [];
        }
        acc[driverId].push(shipment);
        return acc;
    }, {});

    // --- Buat rute untuk setiap supir ---
    for (const driverId in shipmentsByDriver) {
        let customersForDriver = shipmentsByDriver[driverId];
        const driverInfo = customersForDriver[0];
        const vehicle = { capacity: driverInfo.capacity, vehicle_name: driverInfo.vehicle_name };
        
        let tripCount = 1;
        while (customersForDriver.length > 0) {
            const route = {
                vehicle_name: `${driverInfo.driver_name} - ${vehicle.vehicle_name} (Trip ${tripCount})`,
                vehicle_capacity: vehicle.capacity,
                total_load: 0,
                total_distance: 0,
                total_sales: 0,
                path_stops: [depot]
            };
            let currentCapacity = parseInt(vehicle.capacity);
            let currentLocation = depot;

            while (true) {
                let nearestCustomer = null, minDistance = Infinity, nearestCustomerIndex = -1;
                customersForDriver.forEach((customer, index) => {
                    if (parseInt(customer.demand) <= currentCapacity) {
                        const distance = haversineDistance(currentLocation, customer);
                        if (distance < minDistance) {
                            minDistance = distance; nearestCustomer = customer; nearestCustomerIndex = index;
                        }
                    }
                });

                if (nearestCustomer) {
                    route.total_load += parseInt(nearestCustomer.demand);
                    route.total_sales += parseFloat(nearestCustomer.sales_value);
                    route.total_distance += minDistance;
                    currentCapacity -= parseInt(nearestCustomer.demand);
                    route.path_stops.push(nearestCustomer);
                    currentLocation = nearestCustomer;
                    customersForDriver.splice(nearestCustomerIndex, 1);
                } else {
                    break;
                }
            }

            if (route.total_load > 0) {
                route.total_distance += haversineDistance(currentLocation, depot);
                route.path_stops.push(depot);

                // --- LOGIKA ANALISA RUTE ---
                const analysis = { status: 'Produktif', message: 'Rute ini terlihat efisien.' };
                const salesPerKm = route.total_sales / (route.total_distance || 1);
                const payloadEfficiency = route.total_load / route.vehicle_capacity;

                if (salesPerKm < 50000 && payloadEfficiency < 0.5) {
                    analysis.status = 'Tidak Produktif';
                    analysis.message = 'Biaya perjalanan mungkin lebih tinggi dari nilai penjualan.';
                } else if (salesPerKm < 100000) {
                    analysis.status = 'Kurang Produktif';
                    analysis.message = 'Kepadatan penjualan per kilometer tergolong rendah.';
                }
                route.analysis = analysis;
                
                solution.routes.push(route);
            }
            tripCount++;
            if(tripCount > 10) break;
        }
    }
    
    return solution;
}

function haversineDistance(coords1, coords2) {
    function toRad(x) { return x * Math.PI / 180; }
    const R = 6371;
    const dLat = toRad(parseFloat(coords2.lat) - parseFloat(coords1.lat));
    const dLon = toRad(parseFloat(coords2.lon) - parseFloat(coords1.lon));
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(parseFloat(coords1.lat))) * Math.cos(toRad(parseFloat(coords2.lat))) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

app.listen(port, () => {
    console.log(`Server VRP (Analisa Final) berjalan di http://localhost:${port}`);
});
