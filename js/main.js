// main.js
// Import DuckDB
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

// Initialize DuckDB
async function initDuckDB() {
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker = await duckdb.createWorker(bundle.mainWorker);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule);
    return db;
}

async function loadCSV(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    return await response.text();
}

async function loadData() {
    try {
        const db = await initDuckDB();
        const conn = await db.connect();

        // Load CSV
        const csvText = await loadCSV('./data/test/data.csv');

        // Register CSV as a table
        await db.registerFileText('data.csv', csvText);
        await conn.query(`
          CREATE TABLE data AS 
          SELECT * FROM read_csv_auto('data.csv')
        `);

        // Query data: group by day and count records
        const roundsData = await conn.query(`
          SELECT 
            CAST(DATE_TRUNC('day', time) AS DATE) AS day,
            CAST(strftime(DATE_TRUNC('day', time), '%Y') AS INTEGER) AS year,
            CAST(strftime(DATE_TRUNC('day', time), '%m') AS INTEGER) AS month,
            CAST(COUNT(*) AS DOUBLE) AS rounds
          FROM data
          GROUP BY DATE_TRUNC('day', time)
          ORDER BY day
        `);

        const rounds = roundsData.toArray();
        console.log('Rounds data:', rounds);

        // Query data: group by day and sum value
        const valueData = await conn.query(`
          SELECT 
            CAST(DATE_TRUNC('day', time) AS DATE) AS day,
            CAST(strftime(DATE_TRUNC('day', time), '%Y') AS INTEGER) AS year,
            CAST(strftime(DATE_TRUNC('day', time), '%m') AS INTEGER) AS month,
            CAST(SUM(value) AS DOUBLE) AS total_value
          FROM data
          GROUP BY DATE_TRUNC('day', time)
          ORDER BY day
        `);

        const value = valueData.toArray();
        console.log('Value data:', value);

        await conn.close();
        await db.terminate();

        // Initialize charts after data is loaded
        const ctx1 = document.getElementById('roundsChart').getContext('2d');
        window.roundsChart = new window.Chart(ctx1, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Rounds',
                    data: [],
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.2)',
                    fill: true
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'category',
                        title: { display: true, text: 'Date' },
                        ticks: {
                            callback: function(value, index, ticks) {
                                const label = this.getLabelForValue(index);
                                const date = new Date(label);
                                if (isNaN(date)) return label;
                                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Rounds' },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(tooltipItems) {
                                const label = tooltipItems[0].label;
                                const date = new Date(label);
                                if (isNaN(date)) return label;
                                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                            }
                        }
                    }
                }
            }
        });

        const ctx2 = document.getElementById('valueChart').getContext('2d');
        window.valueChart = new window.Chart(ctx2, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Value',
                    data: [],
                    borderColor: '#f11212',
                    backgroundColor: 'rgba(241, 18, 18, 0.2)',
                    fill: true
                }]
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'category',
                        title: { display: true, text: 'Date' },
                        ticks: {
                            callback: function(value, index, ticks) {
                                const label = this.getLabelForValue(index);
                                const date = new Date(label);
                                if (isNaN(date)) return label;
                                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Value' },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: function(tooltipItems) {
                                const label = tooltipItems[0].label;
                                const date = new Date(label);
                                if (isNaN(date)) return label;
                                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                            }
                        }
                    }
                }
            }
        });

        // Populate year filter
        const years = [...new Set(rounds.map(r => r.year))].sort((a, b) => b - a);
        const yearSelect = document.getElementById('yearSelect');
        years.forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.text = year;
            yearSelect.appendChild(option);
        });

        // Event listeners for filters
        const monthSelect = document.getElementById('monthSelect');
        const rangeSelect = document.getElementById('rangeSelect');

        function updateChart() {
            const selectedYear = yearSelect.value === 'all' ? null : parseInt(yearSelect.value);
            const selectedMonth = monthSelect.value === 'all' ? null : parseInt(monthSelect.value);
            const range = parseInt(rangeSelect.value) || null;

            let filteredRounds = rounds;
            let filteredValues = value;

            if (range) {
                const latestDate = new Date(Math.max(...rounds.map(r => new Date(r.day))));
                const startDate = new Date(latestDate);
                startDate.setMonth(startDate.getMonth() - range);
                filteredRounds = rounds.filter(r => new Date(r.day) >= startDate);
                filteredValues = value.filter(r => new Date(r.day) >= startDate);
            } else {
                filteredRounds = rounds.filter(r =>
                    (!selectedYear || r.year === selectedYear) &&
                    (!selectedMonth || r.month === selectedMonth)
                );
                filteredValues = value.filter(r =>
                    (!selectedYear || r.year === selectedYear) &&
                    (!selectedMonth || r.month === selectedMonth)
                );
            }

            // Format dates as YYYY-MM-DD for chart labels
            const formatDate = (date) => {
                const d = new Date(date);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            };

            // Update rounds chart data
            window.roundsChart.data.labels = filteredRounds.map(r => formatDate(r.day));
            window.roundsChart.data.datasets[0].data = filteredRounds.map(r => Number(r.rounds));
            window.roundsChart.update();

            // Update value chart data
            window.valueChart.data.labels = filteredValues.map(r => formatDate(r.day));
            window.valueChart.data.datasets[0].data = filteredValues.map(r => Number(r.total_value));
            window.valueChart.update();
        }

        yearSelect.addEventListener('change', updateChart);
        monthSelect.addEventListener('change', updateChart);
        rangeSelect.addEventListener('change', () => {
            if (rangeSelect.value) {
                yearSelect.disabled = true;
                monthSelect.disabled = true;
            } else {
                yearSelect.disabled = false;
                monthSelect.disabled = false;
            }
            updateChart();
        });

        // Initial chart render
        updateChart();

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load data. Please check the console for details.');
    }
}

loadData();

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        // Deactivate all tabs
        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));

        // Activate clicked tab
        button.classList.add('active');
        const target = document.getElementById(button.dataset.target);
        target.classList.add('active');
    });
});
